/**
 * ContinuationCard — Member-facing "After Your Contract" card
 *
 * Displays the coach-configured continuation (month-to-month) pricing
 * with premium copy. Shown in CoachingInvestmentSection when
 * continuationPricing.continuationEnabled !== false.
 */

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { MemberPlanData } from '../lib/planTypes';
import { CtsOptInModal } from './CtsOptInModal';

// ── Design tokens (duplicated from parent file to keep component self-contained)
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const ACCENT = '#6EBB7A';
const GOLD = '#F5A623';
const GOLD_BG = 'rgba(245,166,35,0.08)';
const GOLD_BORDER = 'rgba(245,166,35,0.3)';
const BORDER = '#2A3347';
const FH = 'System';

function formatCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Pricing card style (mirrors inv.priceCard from parent)
const priceCard: object = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderWidth: 1,
  borderColor: '#2A3347',
  borderRadius: 10,
  padding: 12,
  alignItems: 'center' as const,
};
const priceLabel: object = { color: '#7A8A9A', fontSize: 10, fontWeight: '700' as const, letterSpacing: 1.2, marginBottom: 4 };
const priceAmount: object = { color: '#FFF', fontSize: 22, fontWeight: '700' as const };
const priceSuffix: object = { fontSize: 13, color: '#7A8A9A' };
const priceDetail: object = { color: '#7A8A9A', fontSize: 11, marginTop: 2 };
const addonCard: object = {
  marginTop: 12,
  borderWidth: 1,
  borderColor: '#2A3347',
  borderRadius: 12,
  padding: 14,
};

export default function ContinuationCard({
  plan,
  isCoach,
  sessionsPerMonth,
  coachId,
}: {
  plan: MemberPlanData;
  isCoach: boolean;
  sessionsPerMonth: number;
  coachId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [ctsModalVisible, setCtsModalVisible] = useState(false);
  const cp = plan.continuationPricing;

  // Compute continuation monthly rate from stored inputs
  const contHr = cp?.continuationHourlyRate ?? plan.postContract?.hourlyRate ?? plan.hourlyRate ?? 100;
  const contMin = cp?.continuationMinutesPerSession ?? plan.postContract?.sessionMinutes ?? 3.5;
  const contCheckIn = cp?.continuationCheckInMinutesPerMonth ?? 30;
  const contMonthly = Math.round(contHr * (contMin / 60) * sessionsPerMonth);
  const contYearly = contMonthly * 12;
  const contPifYearly = Math.round(contYearly * 0.9); // 10% PIF discount
  const contPifMonthly = Math.round(contPifYearly / 12);
  const contPifSavings = contYearly - contPifYearly;

  // CTS: use explicit override from postContract if set, otherwise half of continuation monthly
  const contCts =
    plan.postContract?.ctsMonthlySavings != null
      ? plan.postContract.ctsMonthlySavings
      : Math.round(contMonthly * 0.5);

  const nutEnabled = plan.nutrition?.enabled ?? false;
  const nutCost = plan.postContract?.nutritionMonthlyCost ?? plan.nutrition?.monthlyCost ?? 25;

  return (
    <View
      style={[
        addonCard,
        { borderColor: 'rgba(245,166,35,0.35)', backgroundColor: 'rgba(245,166,35,0.04)' },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(245,166,35,0.18)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16 }}>{'✨'}</Text>
        </View>

        {/* Content */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>
            After Your Contract
          </Text>
          <Text style={{ color: GOLD, fontSize: 12, marginTop: 2 }}>
            Month-to-month · Cancel anytime
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            {`You've done the hard work. Staying connected to your coach after your contract keeps your momentum alive — on your schedule, at a rate that reflects where you are.`}
          </Text>

          <Pressable onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
            <Text style={{ color: GOLD, fontSize: 13, fontWeight: '600' }}>
              {expanded ? 'Hide details \u25b4' : 'See your continuation rate \u25be'}
            </Text>
          </Pressable>

          {expanded && (
            <View
              style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}
            >
              {/* Pricing grid */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={[priceCard, { flex: 1 }]}>
                  <Text style={priceLabel}>MONTHLY</Text>
                  <Text style={priceAmount}>
                    {formatCurrency(contMonthly)}
                    <Text style={priceSuffix}>/mo</Text>
                  </Text>
                  <Text style={priceDetail}>Cancel anytime</Text>
                </View>
                <View style={[priceCard, { flex: 1, borderColor: GOLD_BORDER }]}>
                  <Text style={[priceLabel, { color: GOLD }]}>PAY IN FULL</Text>
                  <Text style={priceAmount}>
                    {formatCurrency(contPifMonthly)}
                    <Text style={priceSuffix}>/mo</Text>
                  </Text>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
                    Save {formatCurrency(contPifSavings)}/yr
                  </Text>
                </View>
              </View>

              {/* Commit to Save + PIF stacking */}
              <View
                style={{
                  padding: 10,
                  backgroundColor: GOLD_BG,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: GOLD_BORDER,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>
                  {'\uD83D\uDCA1'} Commit to Save \u2014 Half Off
                </Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  {`Stay consistent and lock in ${formatCurrency(contCts)}/mo \u2014 half your standard continuation rate. The same accountability rules apply.`}
                </Text>
                <View style={{ marginTop: 6, padding: 8, backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(110,187,122,0.2)' }}>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600' }}>
                    Pay in Full + CTS: {formatCurrency(Math.max(0, contPifMonthly - contCts))}/mo
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>
                    Both discounts stack \u2014 10% pay-in-full + half off CTS
                  </Text>
                </View>
                {!isCoach && plan.status === 'active' && (() => {
                  // CTS button only visible after contract period ends (RISK-001)
                  const endAt = (plan as any).contractEndAt;
                  const contractEnded = endAt ? (endAt.toMillis ? endAt.toMillis() : endAt.seconds * 1000) <= Date.now() : false;
                  return contractEnded;
                })() && (
                  <Pressable
                    onPress={() => setCtsModalVisible(true)}
                    style={{ marginTop: 8, backgroundColor: GOLD, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>
                      {`Commit to Save — ${formatCurrency(contCts)}/mo`}
                    </Text>
                  </Pressable>
                )}
              </View>
              {!isCoach && (
                <CtsOptInModal
                  visible={ctsModalVisible}
                  onClose={() => setCtsModalVisible(false)}
                  memberId={plan.memberId}
                  planId={plan.id ?? ''}
                  coachId={coachId}
                  ctsMonthlyRate={contCts}
                  standardMonthlyRate={contMonthly}
                  ctsMonthlyFormatted={formatCurrency(contCts)}
                  standardMonthlyFormatted={formatCurrency(contMonthly)}
                />
              )}

              {/* Nutrition */}
              {nutEnabled && (
                <View
                  style={{
                    padding: 10,
                    backgroundColor: 'rgba(110,187,122,0.08)',
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: 'rgba(110,187,122,0.3)',
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>
                    {'🥗'} Nutrition Add-On
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    {`Keep your nutrition coaching going for +${formatCurrency(nutCost)}/mo. New monthly: ${formatCurrency(contMonthly + nutCost)}.`}
                  </Text>
                </View>
              )}

              {/* What's included */}
              <View
                style={{
                  padding: 10,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: BORDER,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>
                  {"What's included"}
                </Text>
                {[
                  `Monthly ${Math.round(contCheckIn)} min check-in call`,
                  'Ongoing workout programming',
                  'Form feedback & accountability',
                  'Direct coach access',
                ].map((item, i) => (
                  <Text key={i} style={{ color: MUTED, fontSize: 12, lineHeight: 20 }}>
                    {'\u2713  '}{item}
                  </Text>
                ))}
              </View>

              {/* Referral reset */}
              <View
                style={{
                  padding: 10,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>
                  {'🎁'} Referral Clock Resets
                </Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  {`Refer 3 friends into a yearly plan within ${plan.contractMonths || 12} months and your base membership is refunded — same rules as your original contract.`}
                </Text>
              </View>

              {/* Coach-only formula note */}
              {isCoach && (
                <View
                  style={{
                    marginTop: 8,
                    padding: 8,
                    backgroundColor: 'rgba(91,155,213,0.08)',
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: 'rgba(91,155,213,0.2)',
                  }}
                >
                  <Text style={{ color: PRIMARY, fontSize: 11, lineHeight: 16 }}>
                    {`Coach: ${formatCurrency(contHr)}/hr x ${contMin} min/session x ${sessionsPerMonth} sessions/mo = ${formatCurrency(contMonthly)}/mo`}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
