/**
 * AdminLeadsTab — platformAdmin queue of unassigned intake leads.
 *
 * Lists members with coachId 'unassigned' (people who completed the public
 * intake form without choosing a coach), joined with their intake submission
 * for goals and contact details, and lets the admin assign each lead to a
 * coach via the adminAssignLeadToCoach callable (which also refreshes the
 * member's claims and notifies the coach).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';

const FONT_HEADING = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CARD_BG = '#1A2035';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const RED = '#E05252';
const MUTED = '#8A95A3';
const FG = '#F0F4F8';

interface LeadCoachOption {
  uid: string;
  name: string;
  email: string;
}

interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  hasAccount: boolean;
  createdAt?: any;
  goals: string;
  whyStatement: string;
}

function formatDate(ts: any): string {
  const d = ts?.toDate?.();
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminLeadsTab({ coaches }: { coaches: LeadCoachOption[] }) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCoach, setSelectedCoach] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'members'), where('coachId', '==', 'unassigned')),
      );
      const rows: LeadRow[] = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as any;
          let goals = '';
          let whyStatement = '';
          try {
            const intakeSnap = await getDoc(doc(db, 'intakeSubmissions', d.id));
            if (intakeSnap.exists()) {
              const intake = intakeSnap.data() as any;
              const list = Array.isArray(intake.primaryGoals)
                ? intake.primaryGoals.filter((g: unknown) => typeof g === 'string')
                : [];
              goals = [list.join(', '), intake.specificGoals].filter(Boolean).join(' — ');
              whyStatement = intake.whyStatement || '';
            }
          } catch (err) {
            console.warn('[AdminLeadsTab] intake load failed for', d.id, err);
          }
          return {
            id: d.id,
            name: data.displayName || data.name || '—',
            email: data.email || '',
            phone: data.phone || '',
            hasAccount: data.hasAccount === true && !!data.uid,
            createdAt: data.createdAt,
            goals,
            whyStatement,
          };
        }),
      );
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setLeads(rows);
    } catch (err) {
      console.error('[AdminLeadsTab] leads load error:', err);
      setError('Failed to load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  async function assignLead(leadId: string) {
    const coachId = selectedCoach[leadId];
    if (!coachId || assigningId) return;
    setAssigningId(leadId);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'adminAssignLeadToCoach');
      await fn({ memberId: leadId, coachId });
      setLeads((rows) => rows.filter((r) => r.id !== leadId));
    } catch (err: any) {
      console.error('[AdminLeadsTab] assign failed:', err);
      setError(err?.message || 'Failed to assign lead.');
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <View>
      <Text style={ls.sectionTitle}>UNASSIGNED LEADS</Text>
      <Text style={ls.sectionSub}>
        Members who completed the intake form without choosing a coach. Assigning moves them onto the coach's roster and notifies the coach — the member sees their coach on their next app open.
      </Text>

      {error ? <Text style={ls.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color={GOLD} style={{ marginVertical: 32 }} />
      ) : leads.length === 0 ? (
        <View style={ls.emptyBox}>
          <Text style={ls.emptyText}>No unassigned leads. 🎉</Text>
        </View>
      ) : (
        leads.map((lead) => (
          <View key={lead.id} style={ls.card}>
            <View style={ls.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={ls.leadName}>{lead.name}</Text>
                <Text style={ls.leadMeta} numberOfLines={1}>
                  {[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact info'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={ls.leadDate}>{formatDate(lead.createdAt)}</Text>
                <View style={[ls.accountBadge, lead.hasAccount && ls.accountBadgeLinked]}>
                  <Text style={[ls.accountBadgeText, lead.hasAccount && ls.accountBadgeTextLinked]}>
                    {lead.hasAccount ? 'Has account' : 'No login'}
                  </Text>
                </View>
              </View>
            </View>

            {lead.goals ? (
              <Text style={ls.leadGoals} numberOfLines={2}>
                <Text style={{ color: GOLD, fontWeight: '700' }}>Goals: </Text>
                {lead.goals}
              </Text>
            ) : null}
            {lead.whyStatement ? (
              <Text style={ls.leadWhy} numberOfLines={2}>"{lead.whyStatement}"</Text>
            ) : null}

            <Text style={ls.assignLabel}>ASSIGN TO COACH</Text>
            <View style={ls.coachChips}>
              {coaches.map((c) => {
                const selected = selectedCoach[lead.id] === c.uid;
                return (
                  <Pressable
                    key={c.uid}
                    onPress={() =>
                      setSelectedCoach((m) => ({ ...m, [lead.id]: selected ? '' : c.uid }))
                    }
                    style={[ls.coachChip, selected && ls.coachChipSelected]}
                  >
                    <Text style={[ls.coachChipText, selected && ls.coachChipTextSelected]} numberOfLines={1}>
                      {c.name !== '—' ? c.name : c.email}
                    </Text>
                  </Pressable>
                );
              })}
              {coaches.length === 0 && (
                <Text style={ls.leadMeta}>No coaches loaded — open the Coaches tab first.</Text>
              )}
            </View>

            <Pressable
              onPress={() => assignLead(lead.id)}
              disabled={!selectedCoach[lead.id] || assigningId !== null}
              style={[ls.assignBtn, (!selectedCoach[lead.id] || assigningId !== null) && { opacity: 0.5 }]}
            >
              {assigningId === lead.id ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={ls.assignBtnText}>Assign</Text>
              )}
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const ls = StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    fontFamily: FONT_HEADING,
    marginTop: 8,
    marginBottom: 6,
  },
  sectionSub: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FONT_BODY,
    lineHeight: 19,
    marginBottom: 16,
  },
  errorText: {
    color: RED,
    fontSize: 13,
    fontFamily: FONT_BODY,
    marginBottom: 12,
  },
  emptyBox: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FONT_BODY,
  },
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  leadName: {
    fontSize: 16,
    fontWeight: '700',
    color: FG,
    fontFamily: FONT_HEADING,
  },
  leadMeta: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FONT_BODY,
    marginTop: 2,
  },
  leadDate: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  accountBadge: {
    backgroundColor: 'rgba(138,149,163,0.15)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  accountBadgeLinked: {
    backgroundColor: 'rgba(110,187,122,0.15)',
  },
  accountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
  },
  accountBadgeTextLinked: {
    color: GREEN,
  },
  leadGoals: {
    fontSize: 13,
    color: FG,
    fontFamily: FONT_BODY,
    lineHeight: 19,
    marginBottom: 4,
  },
  leadWhy: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FONT_BODY,
    fontStyle: 'italic',
    lineHeight: 19,
    marginBottom: 4,
  },
  assignLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    fontFamily: FONT_HEADING,
    marginTop: 10,
    marginBottom: 6,
  },
  coachChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  coachChip: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 180,
  },
  coachChipSelected: {
    borderColor: GOLD,
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  coachChipText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  coachChipTextSelected: {
    color: GOLD,
    fontWeight: '700',
  },
  assignBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 24,
  },
  assignBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_HEADING,
  },
});
