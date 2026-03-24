/**
 * Billing Dashboard — Coach billing overview (Command-style)
 *
 * Route: (app)/billing
 *
 * Business rules sourced from G➲A Program Terms:
 *   - Tier 1: 1-3 clients → 60% coach / 40% G➲A
 *   - Tier 2: 4-6 clients → 65% coach / 35% G➲A
 *   - Tier 3: 7+  clients → 70% coach / 30% G➲A
 *   - Earnings cap: $40,000/year (prorated if mid-year join)
 *   - Profit share: 5% 1st gen, 3% 2nd gen (up to recruited coach's cap)
 *   - Inter-coach referral: 7% of net revenue, first year
 *   - Client referral: 3 referrals → full annual fee refund (G➲A covers 33%)
 *
 * Reads from:
 *   - coachStripeAccounts/{coachId}
 *   - member_plans where coachId == coachId
 *   - ledgerEntries where coachId == coachId (last 90 days)
 *   - profit_share where coachId == coachId
 *   - inter_coach_referrals where referringCoachId == coachId
 *   - referrals where referrerId == coachId (member referrals)
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  StyleSheet, Platform, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  collection, query, where, getDocs, doc, onSnapshot,
  orderBy, limit, Timestamp, updateDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG = '#0E1117';
const CARD_BG = '#161B25';
const BORDER = '#2A3347';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const ACCENT = '#6EBB7A';
const GOLD = '#F5A623';
const RED = '#E05252';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

function formatCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Tier logic (from G➲A Program Terms §5) ──────────────────────────────────
const TIERS = [
  { min: 1, max: 3, platformPct: 40, coachPct: 60, label: 'Tier 1' },
  { min: 4, max: 6, platformPct: 35, coachPct: 65, label: 'Tier 2' },
  { min: 7, max: Infinity, platformPct: 30, coachPct: 70, label: 'Tier 3' },
];

const ANNUAL_CAP = 40_000_00; // $40,000 in cents

function getTier(activeCount: number) {
  return TIERS.find(t => activeCount >= t.min && activeCount <= t.max) ?? TIERS[0];
}

function getNextTier(activeCount: number) {
  const idx = TIERS.findIndex(t => activeCount >= t.min && activeCount <= t.max);
  return idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface StripeAccount {
  stripeAccountId?: string;
  onboardingStatus?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  requirementsDue?: string[];
}

interface MemberPlan {
  id: string;
  memberName?: string;
  memberId?: string;
  memberEmail?: string;
  checkoutStatus?: string;
  status?: string;
  contractEndAt?: any;
  acceptedAt?: any;
}

interface LedgerEntry {
  id: string;
  grossAmountCents: number;
  coachShareCents: number;
  goArriveShareCents: number;
  phase: 'contract' | 'continuation';
  createdAt: Timestamp;
  memberId: string;
}

interface ProfitShareRecord {
  id: string;
  recruitedCoachId: string;
  recruitedCoachName?: string;
  generation: 1 | 2;
  profitSharePct: number; // 5 or 3
  earnedCents: number;
  periodStart?: Timestamp;
  periodEnd?: Timestamp;
}

interface InterCoachReferral {
  id: string;
  referredMemberName?: string;
  receivingCoachId: string;
  receivingCoachName?: string;
  referralFeePct: number; // 7
  referralFeeCents: number;
  createdAt: Timestamp;
}

interface MemberReferral {
  id: string;
  referringMemberId: string;
  referringMemberName?: string;
  referredMemberName?: string;
  referredMemberId: string;
  status: 'pending' | 'converted' | 'expired';
  referralCount?: number; // how many of the 3 needed
  createdAt: Timestamp;
}

interface CtsAccountabilityFee {
  id: string;
  sessionInstanceId: string;
  memberId: string;
  coachId: string;
  planId: string;
  scheduledDate: string;
  scheduledStartTime?: string;
  feeCents: number;
  stripeInvoiceId?: string;
  status: string;
  waived: boolean;
  waivedAt?: Timestamp;
  waivedBy?: string;
  createdAt: Timestamp;
}

interface Task {
  id: string;
  priority: 'urgent' | 'normal' | 'info';
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}

export default function BillingDashboard() {
  const router = useRouter();
  const { claims } = useAuth();
  const coachId = claims?.coachId as string | undefined;

  const [stripeAccount, setStripeAccount] = useState<StripeAccount | null>(null);
  const [memberPlans, setMemberPlans] = useState<MemberPlan[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [profitShares, setProfitShares] = useState<ProfitShareRecord[]>([]);
  const [interCoachReferrals, setInterCoachReferrals] = useState<InterCoachReferral[]>([]);
  const [memberReferrals, setMemberReferrals] = useState<MemberReferral[]>([]);
  const [ctsFees, setCtsFees] = useState<CtsAccountabilityFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tasks' | 'contact' | 'know'>('tasks');
  const [waivingFeeId, setWaivingFeeId] = useState<string | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!coachId) {
      setLoading(false);
      return;
    }

    // Stripe account listener (real-time)
    const accountUnsub = onSnapshot(
      doc(db, 'coachStripeAccounts', coachId),
      (snap) => {
        setStripeAccount(snap.exists() ? (snap.data() as StripeAccount) : null);
      },
      () => setStripeAccount(null)
    );

    const loadAll = async () => {
      try {
        // Member plans
        const plansQ = query(collection(db, 'member_plans'), where('coachId', '==', coachId), limit(200));
        const plansSnap = await getDocs(plansQ);
        setMemberPlans(plansSnap.docs.map(d => ({ id: d.id, ...d.data() } as MemberPlan)));

        // Ledger (last 90 days)
        const ninetyDaysAgo = Timestamp.fromMillis(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const ledgerQ = query(
          collection(db, 'ledgerEntries'),
          where('coachId', '==', coachId),
          where('createdAt', '>=', ninetyDaysAgo),
          orderBy('createdAt', 'desc'),
          limit(500)
        );
        const ledgerSnap = await getDocs(ledgerQ);
        setLedger(ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry)));

        // Profit share records (coaches I recruited)
        const psQ = query(collection(db, 'profit_share'), where('coachId', '==', coachId));
        const psSnap = await getDocs(psQ);
        setProfitShares(psSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProfitShareRecord)));

        // Inter-coach referrals
        const interQ = query(collection(db, 'inter_coach_referrals'), where('referringCoachId', '==', coachId));
        const interSnap = await getDocs(interQ);
        setInterCoachReferrals(interSnap.docs.map(d => ({ id: d.id, ...d.data() } as InterCoachReferral)));

        // Member referrals (members my members have referred)
        const memRefQ = query(collection(db, 'referrals'), where('referrerId', '==', coachId));
        const memRefSnap = await getDocs(memRefQ);
        setMemberReferrals(memRefSnap.docs.map(d => ({ id: d.id, ...d.data() } as MemberReferral)));

        // CTS accountability fees (last 90 days)
        const ctsFeesQ = query(
          collection(db, 'ctsAccountabilityFees'),
          where('coachId', '==', coachId),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const ctsFeesSnap = await getDocs(ctsFeesQ);
        setCtsFees(ctsFeesSnap.docs.map(d => ({ id: d.id, ...d.data() } as CtsAccountabilityFee)));
      } catch (err) {
        console.warn('[BillingDashboard] Load error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
    return () => accountUnsub();
  }, [coachId]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const activePayingCount = memberPlans.filter(
    p => p.checkoutStatus === 'paid' || p.checkoutStatus === 'pay_in_full_paid'
  ).length;

  const tier = getTier(activePayingCount);
  const nextTier = getNextTier(activePayingCount);
  const membersToNextTier = nextTier ? nextTier.min - activePayingCount : 0;

  // Earnings (90 days)
  const totalCoachEarnings90d = ledger.reduce((sum, e) => sum + (e.coachShareCents || 0), 0);

  // Cap progress (this year's ledger — approximate from 90-day window)
  const capProgressPct = Math.min(100, Math.round((totalCoachEarnings90d / ANNUAL_CAP) * 100));

  // Profit share
  const gen1Records = profitShares.filter(r => r.generation === 1);
  const gen2Records = profitShares.filter(r => r.generation === 2);
  const gen1Earnings = gen1Records.reduce((sum, r) => sum + (r.earnedCents || 0), 0);
  const gen2Earnings = gen2Records.reduce((sum, r) => sum + (r.earnedCents || 0), 0);
  const totalProfitShare = gen1Earnings + gen2Earnings;

  // Inter-coach referral earnings
  const interCoachEarnings = interCoachReferrals.reduce((sum, r) => sum + (r.referralFeeCents || 0), 0);

  // Member referrals
  const convertedReferrals = memberReferrals.filter(r => r.status === 'converted').length;
  const pendingReferrals = memberReferrals.filter(r => r.status === 'pending').length;

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const tasks: Task[] = [];

  if (!stripeAccount?.stripeAccountId) {
    tasks.push({
      id: 'stripe_not_connected', priority: 'urgent', icon: '🔗',
      title: 'Connect Stripe to accept payments',
      description: 'Members cannot pay until you connect a Stripe account. Takes about 5 minutes.',
      action: { label: 'Connect Stripe', onPress: () => router.push('/(app)/account' as any) },
    });
  }

  const stripeFullyActive = stripeAccount?.chargesEnabled && stripeAccount?.payoutsEnabled;
  if (stripeAccount?.stripeAccountId && !stripeFullyActive && stripeAccount.onboardingStatus !== 'complete') {
    tasks.push({
      id: 'stripe_onboarding', priority: 'urgent', icon: '⚠️',
      title: 'Complete Stripe onboarding',
      description: 'Your Stripe account setup is incomplete. Members cannot pay until this is resolved.',
      action: { label: 'Resume Setup', onPress: () => router.push('/(app)/account' as any) },
    });
  }

  const reqsDue = stripeAccount?.requirementsDue ?? [];
  if (reqsDue.length > 0) {
    tasks.push({
      id: 'stripe_reqs', priority: 'urgent', icon: '📋',
      title: `${reqsDue.length} Stripe requirement${reqsDue.length > 1 ? 's' : ''} due`,
      description: reqsDue.slice(0, 3).join(' · ') + (reqsDue.length > 3 ? ` +${reqsDue.length - 3} more` : ''),
      action: { label: 'Resolve in Stripe', onPress: () => router.push('/(app)/account' as any) },
    });
  }

  const failedPayments = memberPlans.filter(p => p.checkoutStatus === 'failed');
  failedPayments.forEach(p => {
    tasks.push({
      id: `failed_${p.id}`, priority: 'urgent', icon: '❌',
      title: `Payment failed: ${p.memberName || 'Unknown member'}`,
      description: 'Reach out to update their payment method.',
      action: {
        label: 'View Plan',
        onPress: () => router.push(`/(app)/member-plan/${p.memberId}` as any),
      },
    });
  });

  const now = Date.now();
  const nearingEnd = memberPlans.filter(p => {
    if (!p.contractEndAt) return false;
    const endMs = p.contractEndAt?.seconds ? p.contractEndAt.seconds * 1000 : 0;
    return endMs > now && endMs - now < 30 * 24 * 60 * 60 * 1000;
  });

  nearingEnd.forEach(p => {
    tasks.push({
      id: `ending_${p.id}`, priority: 'normal', icon: '📅',
      title: `Contract ending soon: ${p.memberName || 'Unknown'}`,
      description: 'Discuss continuation options before the contract period ends.',
      action: {
        label: 'View Plan',
        onPress: () => router.push(`/(app)/member-plan/${p.memberId}` as any),
      },
    });
  });

  const acceptedNotPaid = memberPlans.filter(
    p => p.status === 'accepted' && !p.checkoutStatus
  );

  acceptedNotPaid.forEach(p => {
    tasks.push({
      id: `nopay_${p.id}`, priority: 'normal', icon: '💬',
      title: `Accepted but not paid: ${p.memberName || 'Unknown'}`,
      description: 'This member accepted the plan but hasn\'t completed checkout.',
      action: {
        label: 'View Plan',
        onPress: () => router.push(`/(app)/member-plan/${p.memberId}` as any),
      },
    });
  });

  if (tasks.length === 0) {
    tasks.push({
      id: 'all_clear', priority: 'info', icon: '✅',
      title: 'All clear',
      description: 'No urgent tasks right now. Keep building your practice!',
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!coachId) {
    return (
      <View style={s.container}>
        <Text style={{ color: MUTED, textAlign: 'center', marginTop: 80 }}>
          Billing is available for coaches only.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={{ color: PRIMARY, fontSize: 16 }}>{'‹'} Back</Text>
        </Pressable>
        <Text style={s.headerTitle}>Billing</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={PRIMARY} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── Summary Strip ── */}
          <View style={s.summaryCard}>
            <View style={s.summaryRow}>
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>TIER</Text>
                <Text style={[s.summaryValue, { color: ACCENT }]}>{tier.label}</Text>
                <Text style={s.summarySubtext}>{tier.coachPct}/{tier.platformPct} split</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>ACTIVE MEMBERS</Text>
                <Text style={[s.summaryValue, { color: PRIMARY }]}>{activePayingCount}</Text>
                <Text style={s.summarySubtext}>
                  {nextTier ? `${membersToNextTier} to ${nextTier.label}` : 'Max tier'}
                </Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>EARNINGS (90d)</Text>
                <Text style={[s.summaryValue, { color: '#FFF' }]}>{formatCurrency(totalCoachEarnings90d / 100)}</Text>
                <Text style={s.summarySubtext}>your share</Text>
              </View>
            </View>
          </View>

          {/* ── Earnings Cap ── */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.cardTitle}>Earnings Cap</Text>
              <Text style={{ color: MUTED, fontSize: 11 }}>$40,000/year</Text>
            </View>
            <View style={s.capBarBg}>
              <View style={[s.capBarFill, { width: `${capProgressPct}%` as any }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ color: MUTED, fontSize: 11 }}>{formatCurrency(totalCoachEarnings90d / 100)} earned</Text>
              <Text style={{ color: MUTED, fontSize: 11 }}>{capProgressPct}% of cap</Text>
            </View>
            <Text style={{ color: MUTED, fontSize: 10, marginTop: 6, lineHeight: 15 }}>
              After reaching the cap, you keep 100% of additional new-business earnings minus the admin tech fee. Cap resets January 1.
            </Text>
          </View>

          {/* ── Profit Share ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Profit Share</Text>
            <Text style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>
              Coaches you recruited and mentored
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: ACCENT }]}>{gen1Records.length}</Text>
                <Text style={s.statLabel}>1st Gen Coaches</Text>
                <Text style={[s.statSub, { color: ACCENT }]}>{formatCurrency(gen1Earnings / 100)}</Text>
                <Text style={s.statLabel}>earned (5%)</Text>
              </View>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: PRIMARY }]}>{gen2Records.length}</Text>
                <Text style={s.statLabel}>2nd Gen Coaches</Text>
                <Text style={[s.statSub, { color: PRIMARY }]}>{formatCurrency(gen2Earnings / 100)}</Text>
                <Text style={s.statLabel}>earned (3%)</Text>
              </View>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: GOLD }]}>{formatCurrency(totalProfitShare / 100)}</Text>
                <Text style={s.statLabel}>Total Profit Share</Text>
              </View>
            </View>

            {gen1Records.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>YOUR RECRUITS</Text>
                {gen1Records.map(r => (
                  <View key={r.id} style={s.recruitRow}>
                    <View style={[s.contactAvatar, { backgroundColor: ACCENT + '22' }]}>
                      <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700' }}>
                        {(r.recruitedCoachName || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{r.recruitedCoachName || 'Coach'}</Text>
                      <Text style={{ color: MUTED, fontSize: 11 }}>1st gen · 5% share</Text>
                    </View>
                    <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>{formatCurrency(r.earnedCents / 100)}</Text>
                  </View>
                ))}
              </View>
            )}

            {gen2Records.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>2ND GENERATION</Text>
                {gen2Records.map(r => (
                  <View key={r.id} style={s.recruitRow}>
                    <View style={[s.contactAvatar, { backgroundColor: PRIMARY + '22' }]}>
                      <Text style={{ color: PRIMARY, fontSize: 12, fontWeight: '700' }}>
                        {(r.recruitedCoachName || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{r.recruitedCoachName || 'Coach'}</Text>
                      <Text style={{ color: MUTED, fontSize: 11 }}>2nd gen · 3% share</Text>
                    </View>
                    <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>{formatCurrency(r.earnedCents / 100)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── Inter-Coach Referrals ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Inter-Coach Referrals</Text>
            <Text style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>
              Members you referred to other coaches (7% of net revenue, 1st year)
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: PRIMARY }]}>{interCoachReferrals.length}</Text>
                <Text style={s.statLabel}>Referrals Made</Text>
              </View>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: ACCENT }]}>{formatCurrency(interCoachEarnings / 100)}</Text>
                <Text style={s.statLabel}>Total Earned</Text>
              </View>
            </View>

            {interCoachReferrals.length > 0 && (
              <View style={{ marginTop: 12 }}>
                {interCoachReferrals.map(r => (
                  <View key={r.id} style={s.recruitRow}>
                    <View style={[s.contactAvatar, { backgroundColor: PRIMARY + '22' }]}>
                      <Text style={{ color: PRIMARY, fontSize: 12, fontWeight: '700' }}>
                        {(r.referredMemberName || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{r.referredMemberName || 'Member'}</Text>
                      <Text style={{ color: MUTED, fontSize: 11 }}>→ {r.receivingCoachName || 'Coach'}</Text>
                    </View>
                    <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>{formatCurrency(r.referralFeeCents / 100)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── CTS Accountability Fees ── */}
          {ctsFees.length > 0 && (
            <CtsFeesSection
              fees={ctsFees}
              waivingFeeId={waivingFeeId}
              onWaive={async (feeId: string) => {
                setWaivingFeeId(feeId);
                try {
                  const functions = getFunctions();
                  const waiveFn = httpsCallable<{ feeId: string }, { success: boolean; message?: string }>(functions, 'waiveCtsFee');
                  const result = await waiveFn({ feeId });
                  if (result.data.success) {
                    setCtsFees(prev => prev.map(f => f.id === feeId ? { ...f, waived: true, status: 'waived' } : f));
                  }
                } catch (err) {
                  console.warn('[BillingDashboard] Waive error:', err);
                } finally {
                  setWaivingFeeId(null);
                }
              }}
              memberPlans={memberPlans}
            />
          )}

          {/* ── Member Referrals ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Member Referrals</Text>
            <Text style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>
              Members referring new members (3 referrals = full annual fee refund; G➲A covers 33%)
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: ACCENT }]}>{convertedReferrals}</Text>
                <Text style={s.statLabel}>Converted</Text>
              </View>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: GOLD }]}>{pendingReferrals}</Text>
                <Text style={s.statLabel}>Pending</Text>
              </View>
              <View style={[s.statBox, { flex: 1 }]}>
                <Text style={[s.statValue, { color: MUTED }]}>{memberReferrals.length}</Text>
                <Text style={s.statLabel}>Total</Text>
              </View>
            </View>
          </View>

          {/* ── Tabs ── */}
          <View style={s.tabs}>
            {(['tasks', 'contact', 'know'] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[s.tab, activeTab === tab && s.tabActive]}
              >
                <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                  {tab === 'tasks' ? 'Tasks' : tab === 'contact' ? 'Who to Contact' : 'Things to Know'}
                </Text>
                {tab === 'tasks' && tasks.filter(t => t.priority === 'urgent').length > 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{tasks.filter(t => t.priority === 'urgent').length}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>

          {/* Tab content */}
          {activeTab === 'tasks' && <TasksTab tasks={tasks} />}
          {activeTab === 'contact' && (
            <ContactTab
              memberPlans={memberPlans}
              failedPayments={failedPayments}
              nearingEnd={nearingEnd}
              acceptedNotPaid={acceptedNotPaid}
              router={router}
            />
          )}
          {activeTab === 'know' && (
            <KnowTab
              tier={tier}
              activePayingCount={activePayingCount}
              nextTier={nextTier}
              membersToNextTier={membersToNextTier}
              gen1Count={gen1Records.length}
              gen2Count={gen2Records.length}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────
function TasksTab({ tasks }: { tasks: Task[] }) {
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <View
          key={task.id}
          style={[
            s.taskCard,
            task.priority === 'urgent' && { borderColor: 'rgba(224,82,82,0.4)', backgroundColor: 'rgba(224,82,82,0.04)' },
            task.priority === 'info' && { borderColor: 'rgba(110,187,122,0.4)', backgroundColor: 'rgba(110,187,122,0.04)' },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <Text style={{ fontSize: 20, marginTop: 1 }}>{task.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', fontFamily: FH }}>{task.title}</Text>
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 }}>{task.description}</Text>
              {task.action && (
                <Pressable
                  onPress={task.action.onPress}
                  style={{ marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, backgroundColor: PRIMARY + '22', borderRadius: 8, borderWidth: 1, borderColor: PRIMARY + '55' }}
                >
                  <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>{task.action.label}</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Contact Tab (member-specific) ────────────────────────────────────────────
function ContactTab({
  memberPlans, failedPayments, nearingEnd, acceptedNotPaid, router,
}: {
  memberPlans: MemberPlan[];
  failedPayments: MemberPlan[];
  nearingEnd: MemberPlan[];
  acceptedNotPaid: MemberPlan[];
  router: any;
}) {
  const sections = [
    {
      title: 'FAILED PAYMENTS',
      icon: '❌',
      members: failedPayments,
      emptyMsg: 'No failed payments.',
      color: RED,
    },
    {
      title: 'CONTRACTS ENDING SOON',
      icon: '📅',
      members: nearingEnd,
      emptyMsg: 'No contracts ending in the next 30 days.',
      color: GOLD,
    },
    {
      title: 'ACCEPTED BUT NOT PAID',
      icon: '💬',
      members: acceptedNotPaid,
      emptyMsg: 'All accepted members have completed checkout.',
      color: PRIMARY,
    },
  ];

  return (
    <View style={{ gap: 14 }}>
      {sections.map((sec, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 16 }}>{sec.icon}</Text>
            <Text style={{ color: sec.color, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{sec.title}</Text>
            <View style={{ backgroundColor: sec.color + '33', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text style={{ color: sec.color, fontSize: 10, fontWeight: '700' }}>{sec.members.length}</Text>
            </View>
          </View>
          {sec.members.length === 0 ? (
            <Text style={{ color: MUTED, fontSize: 12, paddingLeft: 28 }}>{sec.emptyMsg}</Text>
          ) : (
            sec.members.map(m => (
              <Pressable
                key={m.id}
                onPress={() => router.push(`/(app)/member-plan/${m.memberId}` as any)}
                style={s.contactRow}
              >
                <View style={[s.contactAvatar, { backgroundColor: sec.color + '22' }]}>
                  <Text style={{ color: sec.color, fontSize: 13, fontWeight: '700' }}>
                    {(m.memberName || '?')[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{m.memberName || 'Unknown'}</Text>
                  {m.memberEmail && (
                    <Text style={{ color: MUTED, fontSize: 11, marginTop: 1 }}>{m.memberEmail}</Text>
                  )}
                </View>
                <Text style={{ color: MUTED, fontSize: 16 }}>{'›'}</Text>
              </Pressable>
            ))
          )}
        </View>
      ))}

      {/* Static support contacts */}
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>SUPPORT CONTACTS</Text>
        {[
          { icon: '💳', title: 'Stripe Support', desc: 'Payouts, verification, disputes', link: 'https://support.stripe.com' },
          { icon: '🏢', title: 'GoArrive Support', desc: 'Platform fees, tier questions', link: 'mailto:support@goarrive.com' },
        ].map((c, i) => (
          <Pressable key={i} onPress={() => Linking.openURL(c.link)} style={s.contactRow}>
            <Text style={{ fontSize: 18, marginRight: 4 }}>{c.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{c.title}</Text>
              <Text style={{ color: MUTED, fontSize: 11 }}>{c.desc}</Text>
            </View>
            <Text style={{ color: MUTED, fontSize: 16 }}>{'›'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── CTS Accountability Fees Section ──────────────────────────────────────────────────
function CtsFeesSection({
  fees, waivingFeeId, onWaive, memberPlans,
}: {
  fees: CtsAccountabilityFee[];
  waivingFeeId: string | null;
  onWaive: (feeId: string) => void;
  memberPlans: MemberPlan[];
}) {
  const memberNameMap: Record<string, string> = {};
  memberPlans.forEach(p => { if (p.memberId) memberNameMap[p.memberId] = p.memberName || 'Unknown'; });

  const charged = fees.filter(f => !f.waived);
  const waived = fees.filter(f => f.waived);
  const totalChargedCents = charged.reduce((sum, f) => sum + (f.feeCents || 0), 0);
  const totalWaivedCents = waived.reduce((sum, f) => sum + (f.feeCents || 0), 0);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>CTS Accountability Fees</Text>
      <Text style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>
        Missed session fees charged to Commit-to-Save members
      </Text>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <View style={[s.statBox, { flex: 1 }]}>
          <Text style={[s.statValue, { color: RED }]}>{charged.length}</Text>
          <Text style={s.statLabel}>Charged</Text>
          <Text style={[s.statSub, { color: RED }]}>{formatCurrency(totalChargedCents / 100)}</Text>
        </View>
        <View style={[s.statBox, { flex: 1 }]}>
          <Text style={[s.statValue, { color: ACCENT }]}>{waived.length}</Text>
          <Text style={s.statLabel}>Waived</Text>
          <Text style={[s.statSub, { color: ACCENT }]}>{formatCurrency(totalWaivedCents / 100)}</Text>
        </View>
        <View style={[s.statBox, { flex: 1 }]}>
          <Text style={[s.statValue, { color: '#FFF' }]}>{fees.length}</Text>
          <Text style={s.statLabel}>Total</Text>
        </View>
      </View>

      {fees.map(fee => (
        <View key={fee.id} style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER + '44',
        }}>
          <View style={[s.contactAvatar, { backgroundColor: fee.waived ? ACCENT + '22' : RED + '22' }]}>
            <Text style={{ color: fee.waived ? ACCENT : RED, fontSize: 12, fontWeight: '700' }}>
              {fee.waived ? '\u2713' : '$'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>
              {memberNameMap[fee.memberId] || 'Member'}
            </Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>
              {fee.scheduledDate}{fee.scheduledStartTime ? ` at ${fee.scheduledStartTime}` : ''}
              {' \u00B7 '}{formatCurrency(fee.feeCents / 100)}
              {fee.waived ? ' \u00B7 Waived' : ''}
            </Text>
          </View>
          {!fee.waived && (
            <Pressable
              onPress={() => onWaive(fee.id)}
              disabled={waivingFeeId === fee.id}
              style={{
                paddingHorizontal: 12, paddingVertical: 6,
                backgroundColor: GOLD + '22', borderRadius: 8,
                borderWidth: 1, borderColor: GOLD + '55',
                opacity: waivingFeeId === fee.id ? 0.5 : 1,
              }}
            >
              {waivingFeeId === fee.id
                ? <ActivityIndicator color={GOLD} size="small" />
                : <Text style={{ color: GOLD, fontSize: 12, fontWeight: '600' }}>Waive</Text>
              }
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

// ── Things to Know Tab ─────────────────────────────────────────────────────────────
function KnowTab({ tier, activePayingCount, nextTier, membersToNextTier, gen1Count, gen2Count }: {
  tier: typeof TIERS[0]; activePayingCount: number;
  nextTier: typeof TIERS[0] | null; membersToNextTier: number;
  gen1Count: number; gen2Count: number;
}) {
  const items = [
    {
      icon: '📊',
      title: 'Your current tier split',
      content: `You have ${activePayingCount} active paying member${activePayingCount !== 1 ? 's' : ''}. You keep ${tier.coachPct}% of each payment. GoArrive's platform share is ${tier.platformPct}%.\n\n${nextTier ? `You need ${membersToNextTier} more active paying member${membersToNextTier !== 1 ? 's' : ''} to reach ${nextTier.label} (${nextTier.coachPct}/${nextTier.platformPct} split).` : 'You are at the maximum tier.'}\n\nTier thresholds (from G➲A Program Terms §5):\n• Tier 1 (1–3 members): 60% coach / 40% G➲A\n• Tier 2 (4–6 members): 65% coach / 35% G➲A\n• Tier 3 (7+ members): 70% coach / 30% G➲A\n\nTier is evaluated at checkout time and locked into the payment snapshot. If your client count drops, your tier adjusts accordingly.`,
    },
    {
      icon: '🏆',
      title: 'Earnings cap ($40,000/year)',
      content: `Your annual earnings cap is $40,000 (prorated if you joined mid-year). "New Business" means revenue from clients in their first year with GoArrive.\n\nAfter reaching the cap, you keep 100% of additional new-business earnings minus the monthly admin technology fee.\n\nThe cap resets every January 1st.\n\nAfter reaching the cap, you still pay:\n• 7% inter-coach referral fees\n• Client referral refund contributions`,
    },
    {
      icon: '🔄',
      title: 'How contract → continuation works',
      content: `For monthly members: their subscription automatically transitions to the continuation rate after the contract period ends via a Stripe subscription schedule. No action required.\n\nFor pay-in-full members: a new continuation subscription is created starting at the contract end date. The member will be charged monthly at the continuation rate unless they cancel.\n\nThe continuation rate is set in the plan drawer under "After Contract / Continuation Pricing."`,
    },
    {
      icon: '💡',
      title: 'Commit to Save (CTS)',
      content: `CTS is a discount available to members in the continuation phase only. The default is half the continuation monthly rate.\n\nCTS requires the member to opt in and agree to accountability rules. The button only appears after the contract period has ended.\n\nRISK-001: CTS and pay-in-full discounts do not stack. CTS applies only to continuation; pay-in-full discount applies only to the contract period.`,
    },
    {
      icon: '👥',
      title: 'Profit share',
      content: `You earn profit share from coaches you recruit (G➲A Program Terms §9):\n\n• 1st Generation (direct recruits): 5% of net profits from their clients\n• 2nd Generation (recruited by your recruits): 3% of net profits\n\nBoth are capped at the recruited coach's earnings cap per year and reset annually.\n\nNet profits are calculated monthly; payments are distributed quarterly.\n\nYour current network: ${gen1Count} 1st gen, ${gen2Count} 2nd gen coaches.\n\nProfit sharing ceases if a recruit leaves GoArrive or generates no revenue for 6 consecutive months.`,
    },
    {
      icon: '🤝',
      title: 'Inter-coach referrals',
      content: `When you refer a member to another GoArrive coach (G➲A Program Terms §8):\n\n• You earn 7% of the net revenue the receiving coach generates from that member\n• Duration: first year of the client's engagement\n• Net revenue = income after direct delivery costs\n• Payments calculated monthly, disbursed quarterly\n\nEligibility: the referred client must be new to GoArrive. This program does not apply to coaches you already receive profit share from.`,
    },
    {
      icon: '↩️',
      title: 'Client referral rewards',
      content: `Members who refer 3 new members within one year receive a full refund of their annual fees (G➲A Program Terms §7).\n\nContribution structure:\n• GoArrive covers 33% of the refund\n• Coach contributions are proportional to referrals received\n  (e.g., if you receive 2 of 3 referrals, you cover 2/3 of the coach portion)\n\nConditions:\n• Referred clients must sign up at the minimum support level of the referee\n• All must commit to a 1-year contract\n• Refund is paid after the last payment of the 3rd referral`,
    },
    {
      icon: '↩️',
      title: 'Refunds',
      content: `When a charge is refunded, Stripe automatically refunds the application fee (platform share) proportionally. You are not charged the platform fee on refunded amounts.\n\nAll refunds are recorded as negative entries in the ledger.\n\nRefund policy for members: defined in your coaching agreement. GoArrive does not enforce a refund policy — that is between you and your member.`,
    },
    {
      icon: '⚠️',
      title: 'Setup requirements (ME items)',
      content: `The following must be configured before payments go live:\n\nME-001: Set STRIPE_SECRET_KEY in Cloud Functions:\nfirebase functions:secrets:set STRIPE_SECRET_KEY\n\nME-002: Set STRIPE_WEBHOOK_SECRET:\nfirebase functions:secrets:set STRIPE_WEBHOOK_SECRET\n\nME-003: Set APP_BASE_URL for checkout redirects:\nfirebase functions:config:set app.base_url="https://goarrive.web.app"\n\nME-004: Register the stripeWebhook URL in Stripe Dashboard → Webhooks.`,
    },
  ];

  return (
    <View style={{ gap: 10 }}>
      {items.map((item, i) => (
        <KnowItem key={i} icon={item.icon} title={item.title} content={item.content} />
      ))}
    </View>
  );
}

function KnowItem({ icon, title, content }: { icon: string; title: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded(!expanded)} style={s.infoCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
        <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600', flex: 1, fontFamily: FH }}>{title}</Text>
        <Text style={{ color: MUTED, fontSize: 14 }}>{expanded ? '▾' : '▸'}</Text>
      </View>
      {expanded && (
        <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 10, paddingLeft: 28 }}>
          {content}
        </Text>
      )}
    </Pressable>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'web' ? 16 : 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 60 },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', fontFamily: FH },
  scrollContent: { padding: 16, paddingBottom: 80, gap: 14 },

  // Summary
  summaryCard: {
    backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 16,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 40, backgroundColor: BORDER },
  summaryLabel: { color: MUTED, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  summaryValue: { fontSize: 22, fontWeight: '800', fontFamily: FH },
  summarySubtext: { color: MUTED, fontSize: 10, marginTop: 2 },

  // Cards
  card: {
    backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 16,
  },
  cardTitle: { color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH, marginBottom: 4 },

  // Cap bar
  capBarBg: {
    height: 8, backgroundColor: BORDER, borderRadius: 4, marginTop: 10, overflow: 'hidden',
  },
  capBarFill: {
    height: 8, backgroundColor: ACCENT, borderRadius: 4,
  },

  // Stats
  statBox: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10, alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '800', fontFamily: FH },
  statLabel: { color: MUTED, fontSize: 10, marginTop: 2, textAlign: 'center' },
  statSub: { fontSize: 14, fontWeight: '700', fontFamily: FH, marginTop: 4 },

  // Recruit rows
  recruitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER + '44',
  },

  // Tabs
  tabs: {
    flexDirection: 'row', gap: 4, marginTop: 4,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.03)', flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  tabActive: { backgroundColor: PRIMARY + '22', borderWidth: 1, borderColor: PRIMARY + '55' },
  tabText: { color: MUTED, fontSize: 11, fontWeight: '600' },
  tabTextActive: { color: PRIMARY },
  badge: {
    backgroundColor: RED, borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: '800' },

  // Task cards
  taskCard: {
    backgroundColor: CARD_BG, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    padding: 14,
  },

  // Contact rows
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: BORDER + '44',
  },
  contactAvatar: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },

  // Info cards
  infoCard: {
    backgroundColor: CARD_BG, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    padding: 14,
  },
});
