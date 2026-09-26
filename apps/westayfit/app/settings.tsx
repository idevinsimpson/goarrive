import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../src/auth';
import { CommunityPrivacyControls } from '../src/ui/CommunityPrivacyControls';
import {
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  PROGRESS_GREEN,
  TEXT_MUTED,
} from '../src/ui/kit';
import { MEMBER_TAB_BAR_BODY } from '../src/ui/MemberTabBar';
import { isOverMemberTabs } from '../src/ui/moveSheetRoute';
import { SCRIM_PROPS, sheetData, useSheetExit, useSheetFocusContainment } from '../src/ui/sheetMotion';
import { useReducedMotion } from '../src/ui/useReducedMotion';

/**
 * SETTINGS — the hub.
 *
 * REACHED FROM A ROW INSIDE `You`, NOT FROM A HEADER GEAR AND NOT FROM A SIXTH
 * TAB. The proposal drew a gear in the top-right chrome; the Director refused
 * it because W9 owns the persistent header and hamburger, and a second utility
 * affordance in that corner would either fight W9's or become dead. So this is
 * an ordinary working route that W9 can expose from the hamburger later — real
 * on arrival, with nothing to wire up afterwards.
 *
 * DELIBERATELY THIN. This holds exactly what exists today. A settings hub that
 * lists rows leading nowhere teaches a member the app is unfinished, so
 * anything not built is simply absent rather than disabled.
 */
export default function SettingsScreen() {
  const { user, ready } = useWsfAuth();
  /*
    APP-FEEL-PARITY-1 CHECKPOINT 3. OVER THE MEMBER'S TABS, SETTINGS IS A
    PANEL FROM THE SIDE (the root stack presents it so, app/_layout.tsx):
    a scrim over the dimmed, inert tab, and a panel from the right with its
    title and a named Close, as the reference draws its utility panels
    (ui.tsx `Sheet variant="panel"`, styles.css .demo-surface.panel). It
    travels in from the right (240 ms) and out (180 ms); reduced motion gets
    neither. Focus enters on Close and stays in the panel; Close, Escape and
    the scrim put the member back where they were, and the focus with them.
    Opened cold, it is the page it always was.
  */
  const navigation = useNavigation();
  const [asPanel] = useState<boolean>(() => {
    const st = navigation.getState() as
      | { index?: number; routes: { key: string; name: string; params?: object }[] }
      | undefined;
    const me = st?.routes?.[st.index ?? 0];
    return Boolean(me) && isOverMemberTabs(me!, st);
  });
  const reducedMotion = useReducedMotion();
  const { phase, exit } = useSheetExit(reducedMotion);
  const insets = useSafeAreaInsets();
  const panelRef = useRef<View>(null);
  useSheetFocusContainment(panelRef, asPanel);
  const close = () => exit(() => (router.canGoBack() ? router.back() : router.replace('/you')));
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!asPanel || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !navigation.isFocused()) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asPanel, navigation]);

  if (ready && !user) {
    router.replace('/');
    return null;
  }

  const panel = (children: ReactNode) => (
    <View style={st.panelRoot} testID="wsf-settings-panel-root">
      <Pressable
        style={st.scrim}
        onPress={close}
        testID="wsf-settings-scrim"
        {...SCRIM_PROPS}
        {...(sheetData('scrim', phase) as object)}
      />
      <View
        ref={panelRef}
        style={[st.panel, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        testID="wsf-settings-panel"
        {...({ role: 'dialog', 'aria-modal': true, 'aria-label': 'Settings' } as Record<string, unknown>)}
        {...(sheetData('side', phase) as object)}
      >
        <View style={st.panelHead}>
          <Text style={st.panelTitle} {...({ role: 'heading', 'aria-level': 2 } as Record<string, unknown>)}>
            Settings
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={st.panelClose}
            testID="wsf-settings-close"
          >
            <Text style={st.panelCloseText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={st.panelBody} testID="wsf-settings-screen">
          {children}
        </ScrollView>
      </View>
    </View>
  );

  /*
    COMMUNITY-SETTINGS-PARITY-1. THE PANEL HOLDS THE PRIVACY CONTROLS THEMSELVES
    (Director #489 `5841078939`): one section per joined community, its name as
    the heading and its two switches under it, with the scope said once. The
    separate Privacy page stays for a direct link (`/settings/privacy`) and
    draws the same controls.
  */
  const rows = (
    <>
      <View style={st.identity}>
        {asPanel ? null : <Text style={st.eyebrow}>Settings</Text>}
        <Text style={st.title} {...({ role: 'heading', 'aria-level': 3 } as Record<string, unknown>)}>
          Privacy
        </Text>
      </View>
      <CommunityPrivacyControls />
    </>
  );

  if (asPanel) return panel(rows);

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} testID="wsf-settings-screen">
      <View style={st.chrome}>
        <Pressable
          onPress={() => router.replace('/you')}
          accessibilityRole="link"
          accessibilityLabel="Back to You"
          testID="wsf-settings-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
      </View>

      {rows}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  // ---- the side panel (APP-FEEL-PARITY-1 checkpoint 3) ----
  panelRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,31,53,0.42)' },
  /* The reference's panel: flush right, full height, at most 380 wide, a
     white surface with an 8 px corner. */
  panel: {
    width: '86%',
    maxWidth: 380,
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    shadowColor: '#081D36',
    shadowOpacity: 0.3,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
  },
  panelHead: {
    minHeight: 64,
    paddingLeft: 18,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  panelTitle: { color: NAVY, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  panelClose: { minHeight: 46, minWidth: 64, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  panelCloseText: { color: NAVY, fontSize: 14, fontWeight: '800' },
  panelBody: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, gap: 14 },

  screen: { flex: 1, backgroundColor: CREAM },
  body: { paddingHorizontal: 20, paddingTop: 14, gap: 14, paddingBottom: MEMBER_TAB_BAR_BODY },
  chrome: { flexDirection: 'row', alignItems: 'center' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  identity: { gap: 6 },
  eyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: { color: NAVY, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  rowText: { gap: 2, flex: 1 },
  rowTitle: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  rowSub: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
  chevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },
});
