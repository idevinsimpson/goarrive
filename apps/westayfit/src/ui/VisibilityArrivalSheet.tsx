import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CREAM, HAIRLINE, NAVY, PROGRESS_GREEN, SURFACE, elevation } from './kit';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from './MemberTabBar';
import { VisibilityNote, VisibilityToggle } from './VisibilityToggle';

/**
 * THE ONE TIME A MEMBER IS ASKED, IN THE COMMUNITY IT IS ABOUT.
 *
 * Visibility is per community, so this is deliberately NOT an account
 * onboarding step. A person who is glad to be named among their family has
 * said nothing at all about the gym, and a single global answer would put
 * words in their mouth about every community they ever join. The question is
 * therefore asked on ARRIVAL, in the community it concerns, with that
 * community's name in it.
 *
 * IT DOES NOT BLOCK ANYTHING. The membership already exists and is already
 * private — the Join flow creates it that way and is not touched by this — so
 * a member who dismisses this sheet, force-quits, or never reads it stays
 * exactly as private as they were. "Continue" with the toggle off is the same
 * outcome as closing it. That is why the primary control says Continue rather
 * than Save: there is nothing to save if they change nothing, and a button
 * that implies otherwise pressures an answer.
 *
 * WHY THE JOIN FLOW IS NOT THE PLACE. That flow is hardened, freshly
 * re-baselined, and carries its own privacy and destination-continuity
 * guarantees for people arriving from a link while signed out. Threading a
 * new question through it would put every one of those guarantees back in
 * play to add a control that works perfectly well one screen later, on the
 * first authenticated arrival, where the member can already see the community
 * the question is about.
 *
 * ASKED ONCE PER MEMBERSHIP, NOT ONCE PER PERSON. The server records the
 * answer on the membership row — including an answer of "private", because
 * declining is an answer and re-asking the member who most clearly said no is
 * how a one-time question becomes nagging. A rejoin or a reinstatement
 * deletes that record, so somebody returning to a community is asked again
 * rather than governed by a decision they made before they left.
 */
export function VisibilityArrivalSheet({
  communityName,
  value,
  busy,
  onChange,
  onContinue,
  failed,
  onHeight,
}: {
  communityName: string;
  value: 'private' | 'visible';
  busy?: boolean;
  onChange: (next: 'private' | 'visible') => void;
  onContinue: () => void;
  failed?: boolean;
  /**
   * The sheet's measured height, so the page beneath can make room for it.
   *
   * NOT OPTIONAL IN SPIRIT. Passing taps through the scrim stops the sheet
   * swallowing the whole page, but the sheet's own body still sits on top of
   * whatever is at the foot of it — and on Home that is the member's
   * "Membership options" disclosure, the control somebody uses to LEAVE a
   * community. A privacy invitation that covers the way out is the worst
   * possible thing for it to cover.
   *
   * Measured rather than estimated because the title wraps: "Show my name in
   * <community>?" is one line for a short name and two for a real one, and a
   * constant would be wrong for exactly the communities people actually name.
   */
  onHeight?: (height: number) => void;
}) {
  return (
    /*
      NON-BLOCKING, AND THAT IS ENFORCED BY `pointerEvents`, not by intent.
      `box-none` lets this container be laid out over Home while every tap
      outside the sheet itself passes straight through to what is underneath.

      The first version used an ordinary scrim and it swallowed every control
      on Home — six existing flows failed within one run, which is exactly
      what a member would have met: arriving to check in and finding a privacy
      dialog in the way. An invitation that has to be dismissed before the app
      works is not an invitation, it is a toll gate, and it teaches people to
      dismiss privacy questions without reading them.

      There is no dimming layer for the same reason: a scrim is the visual
      promise that everything behind it is inert, and here it is not.
    */
    <View style={s.scrim} testID="wsf-visibility-arrival" pointerEvents="box-none">
      <View
        style={s.sheet}
        pointerEvents="auto"
        onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      >
        {/*
          AN EYEBROW, NOT A TITLE — the board's own device, the same one that
          reads YOUR COMMUNITY above a community's name and WHAT WE'RE DOING
          above a goal.

          It is here because the approved label says "this community" and names
          none, and a sheet is a distinct object: without one line of context
          it asks a per-community question without saying which community. An
          earlier version used a full headline instead ("Show my name in
          <community>?") directly above a toggle that said almost the same
          words — the same sentence twice, which is exactly the weight this
          design sheds. Eleven letterspaced pixels say which community and
          nothing else.
        */}
        <Text style={s.eyebrow} numberOfLines={1}>
          {communityName.toUpperCase()}
        </Text>
        <VisibilityToggle
          communityName={communityName}
          value={value}
          busy={busy}
          onChange={onChange}
          variant="arrival"
          testID="wsf-visibility-arrival-toggle"
        />
        <VisibilityNote communityName={communityName} variant="arrival" />

        {failed ? (
          <Text style={s.failed} testID="wsf-visibility-arrival-failed">
            That did not save. Nothing has changed — try again.
          </Text>
        ) : null}

        <Pressable
          onPress={onContinue}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(busy) }}
          accessibilityLabel="Continue"
          style={[s.primary, busy ? s.primaryBusy : null]}
          testID="wsf-visibility-arrival-continue"
        >
          <Text style={s.primaryText}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /*
    Over the community, not instead of it. The member can see where they have
    arrived behind the sheet, which is the whole reason the question is asked
    here rather than in a flow.
  */
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 20,
    paddingTop: 20,
    /*
      CLEARS THE TAB BAR, which is permanent chrome on this surface and sits
      above everything. A guessed 34px left Continue half-hidden behind it —
      the sheet's one control, cut in half by the shell. The bar publishes its
      own footprint; use it rather than a number that was right on one phone.
    */
    paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + 12,
    gap: 12,
    ...elevation.card,
    /*
      Its own separation from the page, since nothing dims behind it. Stronger
      than a card's lift because this one sits ON the content rather than in
      the flow of it.
    */
    shadowColor: '#0B1F3A',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
  },
  eyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  failed: { fontSize: 14, lineHeight: 20, color: NAVY },
  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: NAVY,
    borderRadius: 999,
    paddingVertical: 14,
    marginTop: 4,
  },
  primaryBusy: { opacity: 0.6 },
  primaryText: { color: CREAM, fontSize: 16, lineHeight: 21, fontWeight: '600' },
});
