import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACTION_GREEN, CREAM, HAIRLINE, INK_QUIET, NAVY, SURFACE, TEXT_MUTED } from './kit';

/**
 * ONE CONTROL, USED IN EVERY PLACE THIS QUESTION IS ASKED.
 *
 * A member meets this question twice: once on arriving in a community, and
 * again whenever they open that community's people list. It is the same
 * question, so it is the same control with the same words — a toggle that
 * reads "Show my name in <community>" and is OFF until they turn it on.
 *
 * It exists as a component rather than as two similar blocks because the two
 * surfaces drifting apart is the actual risk. A privacy control that is
 * phrased one way on arrival and another way in settings teaches a member that
 * they mean different things, and the moment one copy says "show my name" and
 * the other says "make me visible", somebody has to work out whether they are
 * the same setting. They are.
 *
 * WHY A TOGGLE AND NOT A BUTTON. A button describes an action and has to name
 * the direction it goes — "Show my name" / "Stop showing my name" — so the
 * control's label changes underneath the member and the CURRENT STATE has to
 * be written out in a sentence beside it. A toggle is the state. It reads the
 * same in both positions, and a member can see what is true at a glance
 * instead of reading a paragraph that tells them.
 *
 * OFF IS NOT A PLACEHOLDER. The stored default is private, and the control
 * renders from the stored value — never optimistically. `busy` disables it
 * while a write is in flight, because a toggle that flips before the server
 * has agreed will, on a failed write, show a member as named when they are
 * not. That is the one direction this control must never be wrong in.
 */
export function VisibilityToggle({
  communityName,
  value,
  busy,
  onChange,
  testID,
  nameCommunity,
}: {
  communityName: string;
  value: 'private' | 'visible';
  busy?: boolean;
  onChange: (next: 'private' | 'visible') => void;
  testID?: string;
  /**
   * Put the community's NAME in the label instead of "this community".
   *
   * The arrival sheet sets it, because there the question arrives on its own
   * and "this community" would be asking somebody to work out which one is
   * meant. On the community's own people page the surrounding screen has
   * already said, and repeating the name in the control makes a one-line
   * preference read like a legal form.
   *
   * Same question, same control, same verb, same direction — only the phrase
   * that points at the community changes, and it changes to be MORE specific,
   * never less.
   */
  nameCommunity?: boolean;
}) {
  const on = value === 'visible';
  return (
    <Pressable
      onPress={() => onChange(on ? 'private' : 'visible')}
      disabled={busy}
      // `switch`, so a screen reader announces the STATE rather than reading a
      // label and leaving the member to guess whether it is on.
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: Boolean(busy) }}
      /*
        AND `aria-checked` EXPLICITLY, because this react-native-web version
        does not emit it from `accessibilityState.checked` for role="switch" —
        it emits `aria-disabled` and drops `checked`. A switch with no
        `aria-checked` announces as a switch whose state is unknown, which is
        worse than a plain button: it tells a member there is a state and then
        refuses to say what it is. Spread the way this codebase already passes
        `data-state` through, which is the one form RN-web forwards verbatim.
      */
      {...({ 'aria-checked': on ? 'true' : 'false' } as Record<string, unknown>)}
      accessibilityLabel={`Show my name in ${communityName}`}
      style={[s.row, busy ? s.busy : null]}
      testID={testID ?? 'wsf-visibility-toggle'}
    >
      <Text style={s.label}>
        {nameCommunity ? `Show my name in ${communityName}` : 'Show my name in this community'}
      </Text>
      <View style={[s.track, on ? s.trackOn : null]} testID={`${testID ?? 'wsf-visibility-toggle'}-track`}>
        <View style={[s.knob, on ? s.knobOn : null]} />
      </View>
    </Pressable>
  );
}

/**
 * The one line under the toggle. Kept here beside the control so the two
 * surfaces cannot drift: it names the community, says exactly who can see what
 * — a display name and a role, nothing else — and stops.
 */
export function VisibilityNote({
  communityName,
  withChangeHint,
}: {
  communityName: string;
  /** The arrival sheet adds it; the settings page does not need to say so. */
  withChangeHint?: boolean;
}) {
  return (
    <Text style={s.note}>
      {withChangeHint
        ? 'Members of this community can see your name and role. You can change this anytime.'
        : `When on, members of ${communityName} can see your name and role.`}
    </Text>
  );
}

const TRACK_W = 50;
const TRACK_H = 30;
const KNOB = 24;

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 4,
  },
  busy: { opacity: 0.55 },
  label: { flexShrink: 1, fontSize: 16, lineHeight: 22, color: NAVY },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: (TRACK_H - KNOB) / 2 - 1,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: ACTION_GREEN, borderColor: ACTION_GREEN },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: INK_QUIET,
  },
  knobOn: { backgroundColor: CREAM, alignSelf: 'flex-end' },
  note: { fontSize: 14, lineHeight: 20, color: TEXT_MUTED },
});
