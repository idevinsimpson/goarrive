import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

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
 *     belongs there) says access changed, and that community's record goes.
 */

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
  const [busy, setBusy] = useState<string | null>(null);
  /** Guards a landed answer against a newer load and against another account. */
  const live = useRef(0);

  const load = useCallback(
    async ({ quiet }: { quiet: boolean }) => {
      if (!uid) return;
      const token = ++live.current;
      if (!quiet) setPhase('loading');
      try {
        const answer = await readMyCommunities(uid);
        if (live.current !== token) return;
        setRows((answer.items ?? []) as unknown as CommunityRow[]);
        setPhase('ready');
      } catch (e) {
        if (live.current !== token) return;
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
    async (row: CommunityRow, patch: { name?: Vis; activity?: Vis }) => {
      if (!uid) return;
      setBusy(row.groupId);
      // A new action is the member moving on: the previous message goes.
      setNotice(null);
      try {
        const fn = httpsCallable<{ groupId: string; name?: Vis; activity?: Vis }, SetResponse>(
          getFirebaseFunctions(),
          'wsfSetCommunityVisibility',
        );
        const res = await fn({ groupId: row.groupId, ...patch });
        // ADOPT THE SETTLED VALUE, never the requested one.
        setRows((prev) =>
          prev.map((r) =>
            r.groupId === row.groupId
              ? { ...r, nameVisibility: res.data.name, activityVisibility: res.data.activity }
              : r,
          ),
        );
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && REFUSED.has(code)) {
          forgetCommunity(uid, row.groupId);
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
        await load({ quiet: true });
      } finally {
        setBusy(null);
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
              <Switch
                value={nameOn}
                disabled={busy === r.groupId}
                onValueChange={(v) => void setVisibility(r, { name: v ? 'visible' : 'private' })}
                trackColor={{ true: ACTION_GREEN, false: '#D3CEC4' }}
                style={st.switch}
                testID={`wsf-privacy-name-${r.groupId}`}
                accessibilityLabel={`Show my name in ${r.displayName}`}
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
              <Switch
                value={activityOn}
                disabled={busy === r.groupId}
                onValueChange={(v) => void setVisibility(r, { activity: v ? 'visible' : 'private' })}
                trackColor={{ true: ACTION_GREEN, false: '#D3CEC4' }}
                style={st.switch}
                testID={`wsf-privacy-activity-${r.groupId}`}
                accessibilityLabel={`Show my activity in ${r.displayName}`}
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
  switch: { width: 48, height: 28 },
  note: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17, paddingTop: 4 },
  footnote: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
});
