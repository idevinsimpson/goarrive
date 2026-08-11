import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import { BG, CARD, BORDER, FG, GOLD, MUTED, FH, FB } from '../lib/theme';
import { Icon } from './Icon';

export interface MarketingCtaConfig {
  videoUrl?: string;
  discountCodesEnabled?: boolean;
  subscriptionOptions: {
    id: string;
    label: string;
    priceInCents: number;
    billingInterval: 'month' | 'week' | 'year';
    playbookFolderId?: string;
  }[];
  bookingOptions?: {
    id: string;
    label: string;
    priceInCents: number;
    bookingTokenId: string;
  }[];
}

interface WorkoutFunnelCTAProps {
  ctaConfig: MarketingCtaConfig;
  coachName: string;
  workoutName: string;
  onDismiss: () => void;
}

function formatPrice(cents: number, interval: string): string {
  const dollars = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `$${dollars}/${interval}`;
}

export default function WorkoutFunnelCTA({
  ctaConfig,
  coachName,
  workoutName,
  onDismiss,
}: WorkoutFunnelCTAProps) {
  const [discountCode, setDiscountCode] = useState('');
  const [discountApplied, setDiscountApplied] = useState(false);

  function handleSubscriptionPress(_optionId: string) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert('Coming soon — subscription enrollment is on the way!');
    }
  }

  function handleBookingPress(url?: string) {
    if (!url) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Coming soon — booking is on the way!');
      }
      return;
    }
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url).catch(() => {});
    }
  }

  function handleApplyDiscount() {
    if (discountCode.trim()) {
      setDiscountApplied(true);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Icon name="star" size={32} color={GOLD} />
            <Text style={styles.title}>Keep the momentum going</Text>
            <Text style={styles.subtitle}>
              You just finished {workoutName}. Train with {coachName} every week.
            </Text>
          </View>

          {ctaConfig.subscriptionOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Choose a plan</Text>
              {ctaConfig.subscriptionOptions.map((opt) => (
                <Pressable
                  key={opt.id}
                  style={styles.optionCard}
                  onPress={() => handleSubscriptionPress(opt.id)}
                >
                  <View style={styles.optionLeft}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <Text style={styles.optionPrice}>
                      {formatPrice(opt.priceInCents, opt.billingInterval)}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={GOLD} />
                </Pressable>
              ))}
            </View>
          )}

          {ctaConfig.bookingOptions && ctaConfig.bookingOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Or book a session</Text>
              {ctaConfig.bookingOptions.map((opt) => (
                <Pressable
                  key={opt.id}
                  style={styles.bookingCard}
                  onPress={() => handleBookingPress(undefined)}
                >
                  <View style={styles.optionLeft}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <Text style={styles.optionPrice}>
                      {formatPrice(opt.priceInCents, 'session')}
                    </Text>
                  </View>
                  <Icon name="calendar" size={18} color={GOLD} />
                </Pressable>
              ))}
            </View>
          )}

          {ctaConfig.discountCodesEnabled && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Have a discount code?</Text>
              {discountApplied ? (
                <View style={styles.discountApplied}>
                  <Icon name="check-circle" size={16} color="#4ADE80" />
                  <Text style={styles.discountAppliedText}>
                    Code "{discountCode}" applied!
                  </Text>
                </View>
              ) : (
                <View style={styles.discountRow}>
                  <TextInput
                    style={styles.discountInput}
                    value={discountCode}
                    onChangeText={setDiscountCode}
                    placeholder="Enter code"
                    placeholderTextColor={MUTED}
                    autoCapitalize="characters"
                  />
                  <Pressable
                    style={[styles.discountBtn, !discountCode.trim() && styles.discountBtnDisabled]}
                    onPress={handleApplyDiscount}
                    disabled={!discountCode.trim()}
                  >
                    <Text style={styles.discountBtnText}>Apply</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          <Pressable style={styles.dismissBtn} onPress={onDismiss}>
            <Text style={styles.dismissText}>Not right now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: '100%' as any,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 28,
    gap: 24,
  },
  header: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: FG,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    color: MUTED,
    fontSize: 12,
    fontFamily: FB,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bookingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(125,211,252,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionLeft: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: FG,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FB,
  },
  optionPrice: {
    color: GOLD,
    fontSize: 13,
    fontFamily: FB,
  },
  discountRow: {
    flexDirection: 'row',
    gap: 8,
  },
  discountInput: {
    flex: 1,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: FG,
    fontSize: 14,
    fontFamily: FB,
  },
  discountBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountBtnDisabled: {
    opacity: 0.4,
  },
  discountBtnText: {
    color: BG,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FB,
  },
  discountApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  discountAppliedText: {
    color: '#4ADE80',
    fontSize: 13,
    fontFamily: FB,
  },
  dismissBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    fontWeight: '600',
  },
});
