import { StyleSheet, Text, View } from 'react-native';

import { HomeTarget } from '../../src/ui/designTarget/HomeTarget';

/**
 * A VISUAL TARGET, BEHIND A GATE. NOT A MEMBER SURFACE.
 *
 * The page-by-page gate says a target is built in real React Native and
 * captured, and the page itself is implemented only after that target passes
 * visual review. This route is how a real-RN target gets captured without
 * changing what any member sees: it renders the target composition and nothing
 * else, and it is not linked from the shell, the tab bar or any screen.
 *
 * THE GATE. It renders only when the build was made with
 * EXPO_PUBLIC_WSF_USE_EMULATORS on -- the same flag the capture build uses and
 * the one a staging or production artifact is forbidden to carry
 * (scripts/westayfit/build-staging.sh refuses a build that sets it). So a
 * deployed artifact serves the notice below and never the target.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

export default function HomeTargetPreview() {
  if (!previewAllowed()) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          Design-target previews are not part of this build.
        </Text>
      </View>
    );
  }
  /*
    THE BANNER IS PART OF THE CAPTURE, NOT PART OF THE DESIGN.

    It lives here rather than inside HomeTarget so the component stays clean
    for the day the page is actually implemented from it. Every frame this
    route produces carries the words, burnt into the image, because these
    images circulate: a target that travels without its label is one paste away
    from being read as a shipped screen.

    It costs the composition 20px of height. That is a real cost and a cheap
    one next to the alternative.
  */
  return (
    <View style={style.frame}>
      <View style={style.banner}>
        <Text style={style.bannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
      </View>
      <HomeTarget
        communityName="Smyrna Strong"
        memberCount={23}
        goalTitle="500 Squats by Friday"
        goalWindow="Open · ends Fri, Sep 25"
        sharedTotal={241}
        target={500}
        unit="squats"
        yourPart={45}
        recent={[
          { amount: 20, unit: 'squats', when: '2h ago' },
          { amount: 15, unit: 'squats', when: '5h ago' },
          { amount: 30, unit: 'squats', when: '1d ago' },
        ]}
      />
    </View>
  );
}

const style = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#F7F5F0' },
  banner: {
    height: 20,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: {
    color: '#04260F',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
});
