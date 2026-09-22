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
  variant = 'settings',
}: {
  communityName: string;
  value: 'private' | 'visible';
  busy?: boolean;
  onChange: (next: 'private' | 'visible') => void;
  testID?: string;
  /**
   * Which of the two approved labels this instance wears.
   *
   *   'settings' → "Visible to members"        (the Members page)
   *   'arrival'  → "Show me to this community" (the arrival sheet)
   *
   * Both are the owner's wording for their own surface, and they differ on
   * purpose: the settings row sits under a community's name and count, where
   * "members" is unambiguous and the shortest true phrase wins; the sheet
   * arrives on its own and has to say which community it means.
   *
   * WHAT MAY NOT DIFFER is the thing being asked, the direction of the
   * control, and the fact that off is off. Neither label talks about "your
   * name" being shown or hidden — that phrasing, repeated across a product,
   * is what turns a preference into a preoccupation.
   */
  variant?: 'settings' | 'arrival';
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
      accessibilityLabel={
        variant === 'arrival'
          ? `Show me to ${communityName}`
          : `Visible to members of ${communityName}`
      }
      style={[s.row, busy ? s.busy : null]}
      testID={testID ?? 'wsf-visibility-toggle'}
    >
      <Text style={s.label}>
        {variant === 'arrival' ? 'Show me to this community' : 'Visible to members'}
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
/**
 * The one supporting line, and it is the only explaining either surface does.
 *
 * It says who can see what — a display name and a role, nothing else — and
 * stops. The arrival sheet adds "You can change this anytime", because there
 * the member is meeting the question for the first time and the reversibility
 * is the thing that makes it safe to answer either way.
 */
export function VisibilityNote({
  communityName,
  variant = 'settings',
}: {
  communityName: string;
  variant?: 'settings' | 'arrival';
}) {
  return (
    <Text style={s.note}>
      {variant === 'arrival'
        ? 'Members of this community can see your display name and role when this is on. You can change this anytime.'
        : `When on, members of ${communityName} can see your display name and role.`}
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
  label: { flexShrink: 1, fontSize: 15, lineHeight: 21, color: NAVY },
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
