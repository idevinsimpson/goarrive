import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../auth';
import { describeCallableError } from '../callableErrors';
import { getFirebaseFunctions } from '../firebase';
import { forgetCommunity, readMyCommunities } from '../memberReads';
import { ACTION_GREEN, CARD_BORDER, HAIRLINE, INK_QUIET, NAVY, SURFACE, TEXT_MUTED } from './kit';

/**
 * PRIVACY — how you appear in each of your communities. One set of controls,
 * drawn inside the Settings panel over the member's tabs and on the
 * `/settings/privacy` page alike (COMMUNITY-SETTINGS-PARITY-1; Director #489
 * `5841078939`).
 *
 * PER COMMUNITY, NOT PER ACCOUNT. Somebody glad to be named among the people
 * they train with on Tuesday has said nothing about a group they joined once.
 * The community is the heading and its two controls sit under it.
 *
 * WHAT IS RENDERED IS WHAT IS STORED. `wsfSetCommunityVisibility` returns the
 * SETTLED value and the switch adopts it; nothing is optimistic.
 *
 * A FAILED SAVE STAYS SAID (W7 Check 43). The save error used to be set and
 * then cleared at once by the re-read that followed it (`load()` reset the
 * error), so a failed toggle simply snapped back with no reason given. Now:
 *   · the stored values are re-read QUIETLY -- no "Loading…" flash, and the
 *     message is not cleared by it;
 *   · the message stays until the member retries or makes another change,
 *     and says that what is shown was rechecked with the server (a save can
 *     land even though its reply was lost);
 *   · a refusal (`not-found` / `permission-denied`: this account no longer
 *     belongs there) says access changed, and that community's block and
 *     record go at once.
 *
 * NO LATE ANSWER OVERWRITES A NEWER ONE (hardening addendum, Director #489
 * `5841405625`). Every community + setting has a generation, advanced by each
 * action on it. A save's reply is adopted only if nothing newer happened to
 * that setting, and only for that setting (the reply also carries the other
 * one, which another save may have moved since). A re-read issued before a
 * save lands does not put back what the save settled. A switch takes no
 * second action while its own save is unresolved: nothing optimistic is
 * shown, so a second press could only repeat the first intent. An account
 * epoch, advanced on sign-in change and on close, drops every reply that
 * arrives for an account or a panel that is no longer here.
 */

type Setting = 'name' | 'activity';
const keyOf = (groupId: string, setting: Setting) => `${groupId}:${setting}`;

/** Settled privacy changes, for surfaces that show who is named (the roster). */
const settledListeners = new Set<(groupId: string) => void>();
export function onPrivacySettled(listener: (groupId: string) => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

type Vis = 'visible' | 'private';

type CommunityRow = {
  groupId: string;
  displayName: string;
  nameVisibility: Vis;
  activityVisibility: Vis;
};

type SetResponse = { groupId: string; name: Vis; activity: Vis };

type Notice = { kind: 'error' | 'accessChanged'; text: string };

const REFUSED = new Set(['functions/not-found', 'functions/permission-denied']);

export function CommunityPrivacyControls() {
  const { user, ready } = useWsfAuth();
  const uid = user?.uid ?? null;
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  /** Guards a landed answer against a newer load and against another account. */
  const live = useRef(0);
  /** Advanced on every account change and on unmount: older replies are dropped. */
  const epoch = useRef(0);
  /** Per community + setting: advanced by each action on it. */
  const gens = useRef(new Map<string, number>());
  const busyRef = useRef<ReadonlySet<string>>(busy);
  busyRef.current = busy;

  useEffect(() => {
    epoch.current += 1;
    gens.current = new Map();
    return () => {
      epoch.current += 1;
    };
  }, [uid]);

  const markBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const load = useCallback(
    async ({ quiet }: { quiet: boolean }) => {
      if (!uid) return;
      const token = ++live.current;
      const ep = epoch.current;
      // What each setting's generation was when this read was issued.
      const issued = new Map(gens.current);
      if (!quiet) setPhase('loading');
      try {
        const answer = await readMyCommunities(uid);
        if (live.current !== token || epoch.current !== ep) return;
        const fresh = (answer.items ?? []) as unknown as CommunityRow[];
        setRows((prev) =>
          fresh.map((f) => {
            const shown = prev.find((r) => r.groupId === f.groupId);
            if (!shown) return f;
            // A setting acted on since this read was issued keeps what its
            // own save settled; the read is older than that.
            const keep = (setting: Setting) => {
              const k = keyOf(f.groupId, setting);
              return (gens.current.get(k) ?? 0) !== (issued.get(k) ?? 0) || busyRef.current.has(k);
            };
            return {
              ...f,
              nameVisibility: keep('name') ? shown.nameVisibility : f.nameVisibility,
              activityVisibility: keep('activity') ? shown.activityVisibility : f.activityVisibility,
            };
          }),
        );
        setPhase('ready');
      } catch (e) {
        if (live.current !== token || epoch.current !== ep) return;
        if (!quiet) {
          setNotice({ kind: 'error', text: describeCallableError(e, 'Your communities could not be loaded just now.') });
          setPhase('failed');
        }
      }
    },
    [uid],
  );

  useEffect(() => {
    if (!ready || !uid) return;
    setNotice(null);
    void load({ quiet: false });
  }, [ready, uid, load]);

  const setVisibility = useCallback(
    async (row: CommunityRow, setting: Setting, value: Vis) => {
      if (!uid) return;
      const key = keyOf(row.groupId, setting);
      if (busyRef.current.has(key)) return;
      const gen = (gens.current.get(key) ?? 0) + 1;
      gens.current.set(key, gen);
      const ep = epoch.current;
      busyRef.current = new Set([...busyRef.current, key]);
      markBusy(key, true);
      // A new action is the member moving on: the previous message goes.
      setNotice(null);
      try {
        const fn = httpsCallable<{ groupId: string; name?: Vis; activity?: Vis }, SetResponse>(
          getFirebaseFunctions(),
          'wsfSetCommunityVisibility',
        );
        const res = await fn({ groupId: row.groupId, [setting]: value });
        if (epoch.current !== ep || gens.current.get(key) !== gen) return;
        // ADOPT THE SETTLED VALUE, never the requested one -- and only for the
        // setting this save was about.
        const settled = res.data[setting];
        setRows((prev) =>
          prev.map((r) =>
            r.groupId === row.groupId
              ? setting === 'name'
                ? { ...r, nameVisibility: settled }
                : { ...r, activityVisibility: settled }
              : r,
          ),
        );
        settledListeners.forEach((l) => l(row.groupId));
      } catch (e) {
        if (epoch.current !== ep) return;
        const code = (e as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && REFUSED.has(code)) {
          forgetCommunity(uid, row.groupId);
          setRows((prev) => prev.filter((r) => r.groupId !== row.groupId));
          setNotice({
            kind: 'accessChanged',
            text: `Your access to ${row.displayName} has changed, so its settings are no longer shown here.`,
          });
        } else {
          setNotice({
            kind: 'error',
            text: `${describeCallableError(e, 'That change could not be saved just now.')} We rechecked what is saved, and the switches show it.`,
          });
        }
        // Re-read rather than guess -- quietly, and without clearing the message.
        // This setting's own generation is unchanged, so the re-read may set it.
        markBusy(key, false);
        busyRef.current = new Set([...busyRef.current].filter((k) => k !== key));
        await load({ quiet: true });
      } finally {
        if (epoch.current === ep) markBusy(key, false);
      }
    },
    [uid, load],
  );

  return (
    <View style={st.wrap} testID="wsf-privacy-controls">
      <Text style={st.scope} testID="wsf-privacy-scope">
        Each choice applies only inside that community, to its signed-in members. Never on the public web,
        a display or a kiosk. Your effort still counts toward every total.
      </Text>

      {phase === 'loading' ? (
        <Text style={st.quiet} testID="wsf-privacy-loading">
          Loading your communities…
        </Text>
      ) : null}

      {notice !== null ? (
        <View style={st.noticeRow} testID="wsf-privacy-error" {...({ role: 'alert' } as Record<string, unknown>)}>
          <Text style={st.error}>{notice.text}</Text>
          {phase === 'failed' ? (
            <Pressable
              onPress={() => {
                setNotice(null);
                void load({ quiet: false });
              }}
              accessibilityRole="button"
              style={st.retry}
              testID="wsf-privacy-retry"
            >
              <Text style={st.retryText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {phase === 'ready' && rows.length === 0 ? (
        <Text style={st.quiet} testID="wsf-privacy-none">
          You are not in a community yet. When you join one, your visibility in it appears here.
        </Text>
      ) : null}

      {rows.map((r) => {
        const nameOn = r.nameVisibility === 'visible';
        const activityOn = r.activityVisibility === 'visible';
        return (
          <View key={r.groupId} style={st.block} testID={`wsf-privacy-block-${r.groupId}`}>
            <Text style={st.blockName} numberOfLines={2} {...({ role: 'heading', 'aria-level': 3 } as Record<string, unknown>)}>
              {r.displayName}
            </Text>

            <View style={st.ctrlRow}>
              <View style={st.ctrlText}>
                <Text style={st.ctrlLabel}>Show my name</Text>
                <Text style={st.hint} testID={`wsf-privacy-name-hint-${r.groupId}`}>
                  {nameOn
                    ? 'Members here see your name or initials.'
                    : 'Members here see “Anonymous member” instead of your name.'}
                </Text>
              </View>
              <PrivacySwitch
                value={nameOn}
                disabled={busy.has(keyOf(r.groupId, 'name'))}
                onChange={(v) => void setVisibility(r, 'name', v ? 'visible' : 'private')}
                testID={`wsf-privacy-name-${r.groupId}`}
                label={`Show my name in ${r.displayName}`}
              />
            </View>

            <View style={[st.ctrlRow, st.ctrlRule]}>
              <View style={st.ctrlText}>
                <Text style={st.ctrlLabel}>Show my activity</Text>
                <Text style={st.hint} testID={`wsf-privacy-activity-hint-${r.groupId}`}>
                  {activityOn
                    ? 'Your contributions appear in this community’s activity.'
                    : 'Your contributions are not listed one by one. They still count toward the total.'}
                </Text>
              </View>
              <PrivacySwitch
                value={activityOn}
                disabled={busy.has(keyOf(r.groupId, 'activity'))}
                onChange={(v) => void setVisibility(r, 'activity', v ? 'visible' : 'private')}
                testID={`wsf-privacy-activity-${r.groupId}`}
                label={`Show my activity in ${r.displayName}`}
              />
            </View>

            {/* The combined consequence, in the activity feed's own words. */}
            {!nameOn && activityOn ? (
              <Text style={st.note} testID={`wsf-privacy-note-${r.groupId}`}>
                Your activity appears as “Anonymous member.” Your effort still counts toward the total.
              </Text>
            ) : null}
            {!activityOn ? (
              <Text style={st.note} testID={`wsf-privacy-note-off-${r.groupId}`}>
                {nameOn
                  ? 'Your activity is not shown here. Your effort still counts toward the total.'
                  : 'You are not listed and your activity is not shown here. Your effort still counts toward the total.'}
              </Text>
            ) : null}
          </View>
        );
      })}

      {phase === 'ready' ? (
        <Text style={st.footnote} testID="wsf-privacy-boundary">
          Your Progress stays private to you. Public screens and displays never show names.
        </Text>
      ) : null}
    </View>
  );
}

/** Keyboard focus only: a pointer press does not draw the ring. */
function ensureSwitchCss(): void {
  if (typeof document === 'undefined' || document.getElementById('wsf-privacy-switch')) return;
  const style = document.createElement('style');
  style.id = 'wsf-privacy-switch';
  style.textContent =
    '[data-wsf-switch]:focus{outline:none}' +
    '[data-wsf-switch]:focus-visible{outline:2px solid #3B9FD8;outline-offset:2px}';
  document.head.appendChild(style);
}

/**
 * THE REFERENCE'S TOGGLE (Director #489 `5841078939`; Lovable `d4f60624`
 * ui.tsx): a 48 x 28 track, a 20 px thumb at a 4 px inset, action green when
 * on, and a visible ring for keyboard focus. react-native-web's Switch draws a
 * 28 px thumb over a thinner track and has no ring of its own, so the control
 * is drawn here: a real `role="switch"` with `aria-checked`, pressed by
 * pointer, Enter or Space.
 */
function PrivacySwitch({
  value,
  disabled,
  onChange,
  testID,
  label,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  testID: string;
  label: string;
}) {
  ensureSwitchCss();
  const toggle = () => {
    if (!disabled) onChange(!value);
  };
  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
      style={[sw.track, value ? sw.trackOn : sw.trackOff, disabled ? sw.trackBusy : null]}
      {...({
        'aria-checked': value,
        'aria-disabled': disabled,
        dataSet: { wsfSwitch: '1' },
        // Space toggles a switch; react-native-web only maps Enter for this role.
        onKeyDown: (e: { nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
          if (e.nativeEvent?.key === ' ') {
            e.preventDefault?.();
            toggle();
          }
        },
      } as Record<string, unknown>)}
    >
      <View style={[sw.thumb, value ? sw.thumbOn : sw.thumbOff]} />
    </Pressable>
  );
}

const sw = StyleSheet.create({
  track: { width: 48, height: 28, borderRadius: 14, justifyContent: 'center' },
  trackOn: { backgroundColor: ACTION_GREEN },
  trackOff: { backgroundColor: '#D3CEC4' },
  trackBusy: { opacity: 0.6 },
  thumb: {
    position: 'absolute',
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    shadowColor: '#081D36',
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  thumbOn: { left: 24 },
  thumbOff: { left: 4 },
});

const st = StyleSheet.create({
  wrap: { gap: 12 },
  scope: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 18 },
  quiet: { color: INK_QUIET, fontSize: 14, lineHeight: 20 },
  noticeRow: { gap: 6 },
  error: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  retryText: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  block: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  blockName: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800', marginBottom: 2 },
  // The reference's toggle row: at least 60 px, text beside the switch.
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
  ctrlRule: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  ctrlText: { flex: 1, gap: 2 },
  ctrlLabel: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  hint: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  note: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17, paddingTop: 4 },
  footnote: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
});
