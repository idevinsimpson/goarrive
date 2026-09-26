import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  privacyConsequence,
  privacySaveErrorCopy,
  type CommunityPrivacyPanelProps,
  type PrivacyCommunity,
  type Visibility,
} from './communityParityTypes';
import { ACTION_GREEN, NAVY, PROGRESS_GREEN, SURFACE } from './kit';

/**
 * COMMUNITY PRIVACY PANEL VIEW — the frozen Lovable Settings panel
 * (`e15b9fa0…` @ `d4f60624`, `PrivacySheet` in `src/demo/overlays.tsx` and
 * `PrivacyControls` in `src/demo/screens/you.tsx`) as a PURE presentation
 * component (COMMUNITY-PRESENTATION-ACCELERATOR-1, #447 `5840798701`).
 *
 * It owns no callable, no overlay and no route. The route (W9's) passes the
 * AUTHORITATIVE stored values and the save state, and receives the member's
 * requests through callbacks.
 *
 * THE FAILURE CONTRACT, from W7 Check 43 (measured on `0b460ce3`):
 *   - THE SWITCH SHOWS ONLY WHAT IS STORED. Pressing it asks for the other
 *     value (`onChange`); the switch does not move until the route passes a new
 *     stored value. No optimistic privacy is ever rendered, so a member can
 *     never believe they are private when they are not.
 *   - A FAILED SAVE STAYS SAID. `saveError` is the route's to keep until the
 *     member retries or makes a new change; a re-read of the stored values
 *     does not clear it here, because nothing here clears it.
 *   - The three failures have their own words: not saved; saved-or-not
 *     unknown because the reply was lost (the switch shows what the re-read
 *     found); and refused because the member no longer belongs.
 *   - A SAVE ERROR OUTLIVES THE RE-READ ITSELF. While the route's re-read is
 *     loading, or if it fails, the community's heading and its save error stay
 *     on screen (without switches, which would claim a stored value the panel
 *     does not have); they are not swapped for a generic load message.
 *
 * Switches follow the ARIA switch pattern on web: Enter and Space both ask for
 * the change, the hint (and "Saving…") is the switch's description, and each
 * accessible name starts with the words on screen.
 *
 * Per community, not per account: the community is the heading and its two
 * controls sit under it.
 */
export function CommunityPrivacyPanelView({
  load,
  communities,
  onChange,
  onRetrySave,
  onRetryLoad,
  compact = false,
  testID = 'wsf-privacy-panel',
}: CommunityPrivacyPanelProps) {
  return (
    <View style={s.panel} testID={testID}>
      <ScrollView contentContainerStyle={[s.content, compact ? s.contentCompact : null]}>
        <Text style={s.scope} testID="wsf-privacy-panel-scope">
          Each choice applies only inside that community, to its signed-in members — never the
          public web, a display, a kiosk or marketing. Totals always include you.
        </Text>

        {load === 'loading' ? (
          <Text style={s.quiet} testID="wsf-privacy-panel-loading">
            Loading your communities…
          </Text>
        ) : null}

        {load === 'failed' ? (
          <View style={s.loadFailed} testID="wsf-privacy-panel-load-failed" accessibilityRole={'alert' as never}>
            <Text style={s.errorText}>Your communities couldn’t be loaded just now.</Text>
            <Pressable onPress={onRetryLoad} accessibilityRole="button" style={s.textAction} testID="wsf-privacy-panel-load-retry">
              <Text style={s.textActionLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {load === 'ready' && communities.length === 0 ? (
          <Text style={s.quiet} testID="wsf-privacy-panel-none">
            You are not in a community yet. When you join one, your visibility in it appears here.
          </Text>
        ) : null}

        {load === 'ready'
          ? communities.map((c) => (
              <CommunityBlock key={c.groupId} community={c} onChange={onChange} onRetrySave={onRetrySave} />
            ))
          : communities
              .filter((c) => c.saveError !== null)
              .map((c) => <PendingSaveError key={c.groupId} community={c} onRetrySave={onRetrySave} />)}

        {load === 'ready' ? (
          <Text style={s.foot} testID="wsf-privacy-panel-foot">
            Your private history in Progress always keeps exact amounts.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * A community whose last save failed, while the panel's stored values are
 * being re-read or could not be re-read: its name and the failure, with no
 * switch (the panel has no stored value it can vouch for right now).
 */
function PendingSaveError({
  community: c,
  onRetrySave,
}: {
  community: PrivacyCommunity;
  onRetrySave: CommunityPrivacyPanelProps['onRetrySave'];
}) {
  return (
    <View style={s.block} testID={`wsf-privacy-panel-block-${c.groupId}`}>
      <BlockHeading community={c} />
      <SaveError community={c} busy={c.saving !== null} onRetrySave={onRetrySave} />
    </View>
  );
}

function BlockHeading({ community: c }: { community: PrivacyCommunity }) {
  return (
    <View style={s.blockHeading}>
      <Text style={s.blockName} numberOfLines={2} accessibilityRole="header" aria-level={3}>
        {c.displayName}
      </Text>
      {c.isChampion ? <Text style={s.badge}>CHAMPION</Text> : null}
    </View>
  );
}

function SaveError({
  community: c,
  busy,
  onRetrySave,
}: {
  community: PrivacyCommunity;
  busy: boolean;
  onRetrySave: CommunityPrivacyPanelProps['onRetrySave'];
}) {
  if (c.saveError === null) return null;
  const refused = c.saveError === 'membershipRefused';
  return (
    <View style={s.saveError} accessibilityRole={'alert' as never} testID={`wsf-privacy-panel-error-${c.groupId}`}>
      <Text style={s.errorText}>{privacySaveErrorCopy(c.saveError, c.displayName)}</Text>
      {refused ? null : (
        <Pressable
          onPress={() => onRetrySave(c.groupId)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Try again to save ${c.displayName}`}
          style={s.textAction}
          testID={`wsf-privacy-panel-retry-${c.groupId}`}
        >
          <Text style={s.textActionLabel}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

function CommunityBlock({
  community: c,
  onChange,
  onRetrySave,
}: {
  community: PrivacyCommunity;
  onChange: CommunityPrivacyPanelProps['onChange'];
  onRetrySave: CommunityPrivacyPanelProps['onRetrySave'];
}) {
  const refused = c.saveError === 'membershipRefused';
  const consequence = refused ? null : privacyConsequence(c.stored);
  const busy = c.saving !== null;
  return (
    <View style={s.block} testID={`wsf-privacy-panel-block-${c.groupId}`}>
      <BlockHeading community={c} />

      {refused ? null : (
        <>
          <ToggleRow
            label="Show my name and initials"
            hint={
              c.stored.name === 'visible'
                ? c.shownName
                  ? `Members see “${c.shownName}”`
                  : 'Members see your name'
                : 'Members see “Anonymous member”'
            }
            on={c.stored.name === 'visible'}
            saving={c.saving === 'name'}
            disabled={busy}
            onRequest={(next) => onChange(c.groupId, 'name', next)}
            accessibilityLabel={`Show my name and initials in ${c.displayName}`}
            testID={`wsf-privacy-panel-name-${c.groupId}`}
          />
          <ToggleRow
            label="Show my individual activity"
            hint={c.stored.activity === 'visible' ? 'Your rows appear in momentum' : 'No rows — still counts in the total'}
            on={c.stored.activity === 'visible'}
            saving={c.saving === 'activity'}
            disabled={busy}
            onRequest={(next) => onChange(c.groupId, 'activity', next)}
            accessibilityLabel={`Show my individual activity in ${c.displayName}`}
            testID={`wsf-privacy-panel-activity-${c.groupId}`}
          />
        </>
      )}

      <SaveError community={c} busy={busy} onRetrySave={onRetrySave} />

      {consequence ? (
        <Text style={s.note} testID={`wsf-privacy-panel-note-${c.groupId}`}>
          {consequence}
        </Text>
      ) : null}
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  saving,
  disabled,
  onRequest,
  accessibilityLabel,
  testID,
}: {
  label: string;
  hint: string;
  on: boolean;
  saving: boolean;
  disabled: boolean;
  onRequest: (next: Visibility) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const request = () => onRequest(on ? 'private' : 'visible');
  const hintId = `${testID}-hint`;
  // Space is the ARIA switch pattern's key; react-native-web's Pressable only
  // answers Enter for this role, and Space would scroll the page instead.
  const onKeyDown = (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
    const key = e.nativeEvent.key;
    if (key !== ' ' && key !== 'Spacebar') return;
    e.preventDefault?.();
    if (!disabled) request();
  };
  return (
    <Pressable
      onPress={disabled ? undefined : request}
      disabled={disabled}
      accessibilityRole="switch"
      aria-checked={on}
      aria-disabled={disabled}
      aria-busy={saving}
      aria-describedby={hintId}
      accessibilityLabel={accessibilityLabel}
      style={s.toggleRow}
      testID={testID}
      {...({
        onKeyDown,
        dataSet: { checked: on ? 'true' : 'false', saving: saving ? 'true' : 'false' },
      } as Record<string, unknown>)}
    >
      <View style={s.toggleText}>
        <Text style={s.toggleLabel}>{label}</Text>
        {/* The switch's description; polite, so "Saving…" is heard when it appears. */}
        <Text style={s.toggleHint} id={hintId} aria-live="polite" testID={hintId}>
          {saving ? 'Saving…' : hint}
        </Text>
      </View>
      <View style={[s.track, on ? s.trackOn : null, disabled ? s.trackBusy : null]}>
        <View style={[s.knob, on ? s.knobOn : null]} />
      </View>
    </Pressable>
  );
}

/* Reference tokens (Lovable `d4f60624`, src/styles.css), oklch → hex. */
const MUTED_BG = '#EFEFE6';
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const LINK_GREEN = '#005E19';
const INK = '#081D36';
const ERROR_RED = '#B4232C';

const s = StyleSheet.create({
  panel: { flex: 1, backgroundColor: SURFACE },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22 },
  contentCompact: { paddingTop: 14 },

  /* Block margins collapse in the reference (18 + 18 → 18); here the block's own 18 is the gap. */
  scope: {
    padding: 12,
    backgroundColor: MUTED_BG,
    borderLeftWidth: 3,
    borderLeftColor: PROGRESS_GREEN,
    color: MUTED_FG,
    fontSize: 13,
    lineHeight: 19,
  },
  quiet: { color: MUTED_FG, fontSize: 14, lineHeight: 20 },
  loadFailed: { gap: 6 },

  block: { marginTop: 18 },
  blockHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  blockName: { color: INK, fontSize: 15, lineHeight: 22, fontWeight: '400', flexShrink: 1 },
  badge: { color: LINK_GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  toggleRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  toggleText: { flex: 1, minWidth: 0 },
  toggleLabel: { color: INK, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  toggleHint: { color: MUTED_FG, fontSize: 11, lineHeight: 16, marginTop: 2 },
  track: { width: 48, height: 28, borderRadius: 20, backgroundColor: BORDER, justifyContent: 'center' },
  trackOn: { backgroundColor: ACTION_GREEN },
  trackBusy: { opacity: 0.6 },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: SURFACE,
    shadowColor: NAVY,
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  knobOn: { marginLeft: 24 },

  saveError: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: ERROR_RED,
    backgroundColor: '#FBEDEE',
    gap: 4,
  },
  errorText: { color: INK, fontSize: 13.5, lineHeight: 19 },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  textActionLabel: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },

  note: { color: MUTED_FG, fontSize: 12, lineHeight: 17, paddingTop: 8 },
  foot: { color: MUTED_FG, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
