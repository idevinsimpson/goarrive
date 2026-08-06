import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { MEMBER_JOURNEY_STEPS } from '../../data/coachDiscoveryScenes';
import { DeviceMockup } from './DeviceMockup';
import { discoveryColors, discoveryFonts } from './tokens';

export function MemberJourney({ isMobile }: { isMobile: boolean }) {
  return (
    <View style={[styles.layout, !isMobile && styles.layoutWide]}>
      {isMobile && (
        <View
          style={[
            styles.screenRailMobile,
            Platform.OS === 'web' && ({ position: 'sticky', top: 58 } as any),
          ]}
        >
          <DeviceMockup
            title="Connected member journey"
            caption="Sanitized product captures will transition here."
            variant="panel"
            compact
            accent="green"
          />
        </View>
      )}
      <View style={styles.timeline}>
        <View style={styles.line} />
        {MEMBER_JOURNEY_STEPS.map((step, index) => (
          <View key={step} style={[styles.step, isMobile && styles.stepMobile]}>
            <View style={[styles.marker, index < 6 && styles.markerActive]}>
              <Text style={styles.markerNumber}>{String(index + 1).padStart(2, '0')}</Text>
            </View>
            <View style={styles.stepCopy}>
              <Text style={styles.stepTitle}>{step}</Text>
              <Text style={styles.stepBody}>{journeyDetail(index)}</Text>
            </View>
          </View>
        ))}
      </View>
      {!isMobile && (
        <View style={[styles.screenRail, Platform.OS === 'web' && ({ position: 'sticky', top: 96 } as any)]}>
          <DeviceMockup title="Member intake" caption="A clear, connected start." variant="panel" compact accent="green" />
          <DeviceMockup title="Member plan" caption="The next step stays visible." variant="panel" compact accent="blue" />
          <DeviceMockup title="Reflection + review" caption="Completion becomes another coaching moment." variant="panel" compact accent="green" />
        </View>
      )}
    </View>
  );
}

function journeyDetail(index: number) {
  return [
    'A member begins with a reason to change.',
    'Goals, schedule, barriers, and context come into focus.',
    'The coach shapes a path around the member’s real life.',
    'A professional, connected start—not a sales handoff.',
    'Accountability becomes part of the plan.',
    'Programming, demonstrations, cues, and timing travel together.',
    'Live presence is available where it adds the most value.',
    'The member names what glowed and what could grow.',
    'The session and reflection enter the coach’s review flow.',
    'The coach notices, responds, and adjusts.',
    'Small loops of care become meaningful progress.',
  ][index];
}

const styles = StyleSheet.create({
  layout: {
    width: '100%',
    gap: 34,
  },
  layoutWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 54,
  },
  timeline: {
    flex: 1,
    position: 'relative',
    gap: 4,
  },
  line: {
    position: 'absolute',
    left: 21,
    top: 22,
    bottom: 22,
    width: 1,
    backgroundColor: 'rgba(110,187,122,0.26)',
  },
  step: {
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  stepMobile: {
    minHeight: 250,
  },
  marker: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: discoveryColors.backgroundAlt,
    borderWidth: 1,
    borderColor: discoveryColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  markerActive: {
    borderColor: discoveryColors.green,
    shadowColor: discoveryColors.green,
    shadowOpacity: 0.22,
    shadowRadius: 12,
  },
  markerNumber: {
    color: discoveryColors.green,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '700',
  },
  stepCopy: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: 20,
  },
  stepTitle: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
  },
  stepBody: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  screenRail: {
    width: '44%',
    maxWidth: 430,
    gap: 26,
    paddingTop: 58,
  },
  screenRailMobile: {
    width: '100%',
    zIndex: 20,
    padding: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(8,11,18,0.92)',
  },
});
