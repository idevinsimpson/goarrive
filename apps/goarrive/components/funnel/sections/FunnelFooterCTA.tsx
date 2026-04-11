/**
 * FunnelFooterCTA — canonical final CTA section matching jv.goarrive.fit
 *
 * Centered headline, full-width green CTA, microcopy, powered-by footer.
 * Shared by builder preview and public funnel page.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '../../Icon';

const GREEN = '#7BA05B';

interface Props {
  coachName: string;
}

export function FunnelFooterCTA({ coachName }: Props) {
  const firstName = coachName ? coachName.split(' ')[0] : '';

  return (
    <View style={s.wrap}>
      <View style={s.divider} />

      <View style={s.content}>
        <Text style={s.heading}>Ready to get started?</Text>
        <Text style={s.subtitle}>
          It takes 2 minutes to build your personalized plan.
        </Text>

        <View style={s.cta}>
          <Text style={s.ctaText}>
            Get Started{firstName ? ` with ${firstName}` : ''}
          </Text>
          <Icon name="arrow-right" size={18} color="#FFF" />
        </View>
        <Text style={s.micro}>No spam. No commitment.</Text>
      </View>

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.powered}>Powered by </Text>
        <Text style={s.poweredBrand}>GoArrive</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    position: 'relative',
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: '#2A2E3A',
  },
  content: {
    alignItems: 'center',
    paddingTop: 40,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E8EAF0',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#7A7F94',
    marginBottom: 24,
    textAlign: 'center',
  },
  cta: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 384,
    marginBottom: 8,
  },
  ctaText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  micro: { fontSize: 12, color: '#7A7F94' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 32,
    opacity: 0.3,
  },
  powered: { fontSize: 10, color: '#7A7F94' },
  poweredBrand: { fontSize: 10, fontWeight: '700', color: '#7A7F94' },
});
