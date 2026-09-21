import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AuthErrorTarget,
  ProfileCarryingTarget,
  ProfileSetupTarget,
  ResetPasswordTarget,
  ResetSentTarget,
  ResetUnconfiguredTarget,
  ReturnToEventTarget,
  ReturnToJoinTarget,
  ReturnToKioskTarget,
  SignInTarget,
  SignUpTarget,
  VerifyAlreadyTarget,
  VerifyCarryingTarget,
  VerifyEmailTarget,
  VerifyFailedTarget,
  VerifySendingTarget,
  VerifyUnconfiguredTarget,
} from '../../src/ui/designTarget/AuthTargets';

/**
 * ATLAS BATCH A, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 *
 * Every frame carries its label INSIDE the frame, and the strip is added to
 * the frame's height so the device area beneath it is exactly the class the
 * filename names.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 18;

const SCREENS: { id: string; label: string; tone: string; node: React.ReactNode }[] = [
  { id: 'signin', label: 'Sign in', tone: 'ordinary', node: <SignInTarget /> },
  { id: 'signup', label: 'Sign up · rule stated', tone: 'ordinary', node: <SignUpTarget /> },
  // The five send outcomes the product actually distinguishes.
  { id: 'verify-sending', label: 'Verify · sending', tone: 'action required', node: <VerifySendingTarget /> },
  { id: 'verify', label: 'Verify · sent', tone: 'action required', node: <VerifyEmailTarget /> },
  { id: 'verify-already', label: 'Verify · already verified', tone: 'action required', node: <VerifyAlreadyTarget /> },
  { id: 'verify-unconfigured', label: 'Verify · email off in this build', tone: 'refused', node: <VerifyUnconfiguredTarget /> },
  { id: 'verify-failed', label: 'Verify · send failed', tone: 'error', node: <VerifyFailedTarget /> },
  { id: 'reset', label: 'Reset password', tone: 'ordinary', node: <ResetPasswordTarget /> },
  { id: 'reset-sent', label: 'Reset · sent', tone: 'ordinary', node: <ResetSentTarget /> },
  { id: 'reset-unconfigured', label: 'Reset · email off in this build', tone: 'refused', node: <ResetUnconfiguredTarget /> },
  { id: 'profile', label: 'Profile setup · consent unchecked', tone: 'action required', node: <ProfileSetupTarget /> },
  { id: 'error', label: 'Credential error', tone: 'error', node: <AuthErrorTarget /> },
  // The destination, through all three gates it actually survives.
  { id: 'return-join', label: 'Return to join', tone: 'returning', node: <ReturnToJoinTarget /> },
  { id: 'return-event', label: 'Return to event', tone: 'returning', node: <ReturnToEventTarget /> },
  { id: 'return-kiosk', label: 'Return to kiosk', tone: 'returning', node: <ReturnToKioskTarget /> },
  { id: 'verify-carrying', label: 'Verify · still carrying', tone: 'returning', node: <VerifyCarryingTarget /> },
  { id: 'profile-carrying', label: 'Profile · still carrying', tone: 'returning', node: <ProfileCarryingTarget /> },
];

/** 430x932 was the atlas device gap Batch A left open; it is closed here. */
const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

export default function AuthTargetPreview() {
  if (!previewAllowed()) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          Design-target previews are not part of this build.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-auth-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH A · IDENTITY AND ONBOARDING
        </Text>
      </View>

      {/* THE CONTACT SHEET. One frame, all eight, at a readable scale. */}
      <View style={st.contact} testID="wsf-contact-batch-a">
        <Text style={st.contactTitle}>Atlas Batch A — identity and onboarding</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · seventeen surfaces, five tones · 390×844
        </Text>
        <View style={st.contactGrid}>
          {SCREENS.map((sc) => (
            <View key={sc.id} style={st.contactCell}>
              <View style={st.contactCaption}>
                <Text style={st.contactCaptionText}>{sc.label}</Text>
                <Text style={st.contactTone}>{sc.tone}</Text>
              </View>
              <View style={st.contactFrame}>{sc.node}</View>
            </View>
          ))}
        </View>
      </View>

      {/* The per-class frames the capture spec screenshots one by one. */}
      {CLASSES.map((c) => (
        <View key={c.key} style={st.row}>
          <Text style={st.rowTitle}>{c.key}</Text>
          <View style={st.grid}>
            {SCREENS.map((sc) => (
              <View key={`${sc.id}-${c.key}`} style={[st.cell, { width: c.width }]}>
                <Text style={st.cellLabel}>
                  {sc.label} · {c.key}
                </Text>
                <View
                  style={[st.frame, { width: c.width, height: c.height + FRAME_BANNER }]}
                  testID={`wsf-frame-auth-${sc.id}-${c.key}`}
                >
                  <View style={st.frameBanner} testID={`wsf-frame-banner-auth-${sc.id}-${c.key}`}>
                    <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
                  </View>
                  <View style={{ height: c.height }}>{sc.node}</View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#D9D5CC', padding: 20, gap: 20 },
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  contact: { backgroundColor: '#F7F5F0', borderRadius: 16, padding: 18, gap: 4 },
  contactTitle: { color: '#0B1F3A', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  contactSub: { color: '#6B7C93', fontSize: 12, fontWeight: '700', marginBottom: 12 },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  contactCell: { width: 390, gap: 5 },
  contactCaption: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  contactCaptionText: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  contactTone: { color: '#6B7C93', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  contactFrame: {
    width: 390,
    height: 844,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },

  row: { gap: 8 },
  rowTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
});
