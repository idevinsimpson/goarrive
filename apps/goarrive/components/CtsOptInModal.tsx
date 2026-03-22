/**
 * CtsOptInModal — Commit to Save opt-in flow for post-contract members.
 *
 * Shown when a member taps "Commit to Save" in PostContractCard or ContinuationCard.
 * On confirm:
 *   1. Writes a commitToSaveConsent document to Firestore.
 *   2. Calls the activateCtsOptIn Cloud Function, which updates the Stripe
 *      subscription price to the CTS rate.
 *
 * RISK-001: CTS applies only to the continuation phase. It does NOT stack with
 * the 10% pay-in-full discount (which applies only to the contract period).
 */
import React, { useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';

const BG = '#0E1117';
const CARD_BG = '#141B24';
const BORDER = 'rgba(255,255,255,0.08)';
const GOLD = '#F5A623';
const GOLD_BG = 'rgba(245,166,35,0.08)';
const GOLD_BORDER = 'rgba(245,166,35,0.3)';
const MUTED = '#8A9BB0';
const WHITE = '#FFFFFF';
const FH = 'DM Sans';

interface Props {
  visible: boolean;
  onClose: () => void;
  memberId: string;
  planId: string;
  /** Coach UID — stored in consent doc for coach read access. */
  coachId: string;
  /** The CTS monthly rate (already computed by the caller). */
  ctsMonthlyRate: number;
  /** The standard continuation monthly rate (for context). */
  standardMonthlyRate: number;
  /** Formatted CTS monthly rate string, e.g. "$150". */
  ctsMonthlyFormatted: string;
  /** Formatted standard monthly rate string, e.g. "$300". */
  standardMonthlyFormatted: string;
}

const ACCOUNTABILITY_RULES = [
  'Complete all scheduled sessions — no unexplained no-shows.',
  'Log workouts in the app at least 4 days per week.',
  'Respond to coach check-ins within 48 hours.',
  'If you miss a session without 24-hour notice, a missed-session fee applies.',
  'If you miss two consecutive sessions, CTS is paused until you re-commit.',
];

export function CtsOptInModal({
  visible,
  onClose,
  memberId,
  planId,
  coachId,
  ctsMonthlyRate,
  standardMonthlyRate,
  ctsMonthlyFormatted,
  standardMonthlyFormatted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function handleCommit() {
    if (!agreed) {
      Alert.alert('Please confirm', 'Check the box to confirm you understand the accountability rules.');
      return;
    }
    setLoading(true);
    try {
      // Step 1: Write commitToSaveConsent document
      const consentRef = await addDoc(collection(db, 'commitToSaveConsents'), {
        memberId,
        planId,
        coachId,
        ctsMonthlyRate,
        standardMonthlyRate,
        agreedAt: serverTimestamp(),
        status: 'pending_activation', // updated to 'active' by Cloud Function
      });

      // Step 2: Call Cloud Function to update Stripe subscription
      const functions = getFunctions();
      const activateCts = httpsCallable<
        { consentId: string; planId: string; memberId: string },
        { success: boolean; message?: string }
      >(functions, 'activateCtsOptIn');

      const result = await activateCts({
        consentId: consentRef.id,
        planId,
        memberId,
      });

      if (result.data.success) {
        Alert.alert(
          'Committed! 🎉',
          `You're locked in at ${ctsMonthlyFormatted}/mo. Your subscription has been updated. Keep showing up — your coach is watching.`,
          [{ text: 'Let\'s go', onPress: onClose }]
        );
      } else {
        Alert.alert(
          'Something went wrong',
          result.data.message || 'Could not activate Commit to Save. Please contact your coach.',
          [{ text: 'OK', onPress: onClose }]
        );
      }
    } catch (err: any) {
      console.error('[CtsOptInModal] Error:', err);
      Alert.alert(
        'Error',
        'Could not activate Commit to Save. Please try again or contact your coach.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>💡 Commit to Save</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.closeBtn}>✕</Text>
            </Pressable>
          </View>

          {/* Savings callout */}
          <View style={s.savingsCard}>
            <Text style={s.savingsLabel}>YOUR COMMITMENT RATE</Text>
            <Text style={s.savingsAmount}>{ctsMonthlyFormatted}<Text style={s.savingsSuffix}>/mo</Text></Text>
            <Text style={s.savingsNote}>
              Half off your standard {standardMonthlyFormatted}/mo ongoing rate.
              Applies to your continuation phase only.
            </Text>
          </View>

          {/* Accountability rules */}
          <Text style={s.rulesTitle}>ACCOUNTABILITY RULES</Text>
          <Text style={s.rulesIntro}>
            Commit to Save is a commitment — not just a discount. By tapping "I'm In" you agree to:
          </Text>
          {ACCOUNTABILITY_RULES.map((rule, i) => (
            <View key={i} style={s.ruleRow}>
              <Text style={s.ruleBullet}>•</Text>
              <Text style={s.ruleText}>{rule}</Text>
            </View>
          ))}

          {/* Checkbox agreement */}
          <Pressable style={s.checkRow} onPress={() => setAgreed(!agreed)}>
            <View style={[s.checkbox, agreed && s.checkboxChecked]}>
              {agreed && <Text style={s.checkmark}>✓</Text>}
            </View>
            <Text style={s.checkLabel}>
              I understand the rules and commit to showing up consistently.
            </Text>
          </Pressable>

          {/* CTA */}
          <Pressable
            style={[s.cta, (!agreed || loading) && s.ctaDisabled]}
            onPress={handleCommit}
            disabled={!agreed || loading}
          >
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={s.ctaText}>I'm In — Lock In {ctsMonthlyFormatted}/mo</Text>
            }
          </Pressable>

          <Pressable onPress={onClose} style={s.cancelBtn}>
            <Text style={s.cancelText}>Not right now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    color: WHITE,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  closeBtn: {
    color: MUTED,
    fontSize: 18,
    fontWeight: '600',
  },
  savingsCard: {
    backgroundColor: GOLD_BG,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  savingsLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  savingsAmount: {
    color: GOLD,
    fontSize: 36,
    fontWeight: '800',
    fontFamily: FH,
  },
  savingsSuffix: {
    fontSize: 18,
    fontWeight: '600',
  },
  savingsNote: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  rulesTitle: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  rulesIntro: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  ruleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  ruleBullet: {
    color: GOLD,
    fontSize: 14,
    lineHeight: 20,
  },
  ruleText: {
    color: '#CBD5E0',
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    marginBottom: 20,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: MUTED,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  checkmark: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800',
  },
  checkLabel: {
    color: WHITE,
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  cta: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: FH,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelText: {
    color: MUTED,
    fontSize: 14,
  },
});
