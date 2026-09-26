import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../src/auth';
import { CommunityPrivacyControls } from '../src/ui/CommunityPrivacyControls';
import {
  CREAM,
  HAIRLINE,
  NAVY,
} from '../src/ui/kit';
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
    <View
      style={[
        st.panelRoot,
        {
          paddingTop: PANEL_INSET + insets.top,
          paddingBottom: PANEL_INSET + insets.bottom,
          paddingLeft: PANEL_INSET + insets.left,
          paddingRight: PANEL_INSET + insets.right,
        },
      ]}
      testID="wsf-settings-panel-root"
    >
      <Pressable
        style={st.scrim}
        onPress={close}
        testID="wsf-settings-scrim"
        {...SCRIM_PROPS}
        {...(sheetData('scrim', phase) as object)}
      />
      <View
        ref={panelRef}
        style={st.panel}
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
        {/* W4's privacy panel scrolls itself (Director #497 `5841956174`). */}
        <View style={st.panelFill} testID="wsf-settings-screen">
          {children}
        </View>
      </View>
    </View>
  );

  /*
    COMMUNITY-SETTINGS-PARITY-1. THE PANEL HOLDS THE PRIVACY CONTROLS THEMSELVES
    (Director #489 `5841078939`), drawn by W4's accepted
    `CommunityPrivacyPanelView` through this route's state owner
    (src/ui/CommunityPrivacyControls.tsx; Director #497 `5841956174`). The
    separate Privacy page stays for a direct link (`/settings/privacy`) and
    draws the same panel.
  */
  const rows = <CommunityPrivacyControls compact={asPanel} />;

  if (asPanel) return panel(rows);

  return (
    <View style={st.screen} testID="wsf-settings-screen">
      <View style={[st.chrome, st.pageChrome]}>
        <Pressable
          onPress={() => router.replace('/you')}
          accessibilityRole="link"
          accessibilityLabel="Back to You"
          testID="wsf-settings-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
        <Text style={st.pageTitle} {...({ role: 'heading', 'aria-level': 1 } as Record<string, unknown>)}>
          Settings
        </Text>
      </View>
      <View style={st.panelFill}>{rows}</View>
    </View>
  );
}

/** The reference overlay's padding around its panel. */
const PANEL_INSET = 12;

const st = StyleSheet.create({
  // ---- the side panel (APP-FEEL-PARITY-1 checkpoint 3) ----
  panelRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,31,53,0.42)' },
  /* The frozen reference's panel (Lovable @ d4f60624, styles.css
     `.demo-overlay.panel` padding 12px + `.demo-surface.panel` max-width
     380px, radius 8): inset 12 px from every viewport edge (plus the safe
     area), at most 380 wide -- 366 at a 390 viewport -- the full height inside
     the inset, an 8 px corner all round (Director #506 `5844878042`). */
  panel: {
    width: '100%',
    maxWidth: 380,
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
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
  panelFill: { flex: 1 },
  pageChrome: { paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  pageTitle: { color: NAVY, fontSize: 22, lineHeight: 28, fontWeight: '800' },

  screen: { flex: 1, backgroundColor: CREAM },
  chrome: { flexDirection: 'row', alignItems: 'center' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
});
