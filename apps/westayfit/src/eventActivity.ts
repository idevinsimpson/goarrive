/**
 * THE ACTIVITY A SCANNED PHONE IS CARRYING, AND THE CHOICE THAT FOLLOWS IT.
 *
 * WHAT THIS IS FOR. An attendee walks up to a screen in a hall, scans the code
 * on it, and — if they are new — signs up, verifies an address, fills in a
 * profile and joins a community before they see anything about the event
 * again. Four routes and a mail round trip later they land back on the event.
 * Two things about WHERE THEY WERE STANDING have to still be true at the end
 * of that: which EVENT they scanned, and which ACTIVITY that screen was
 * running. The event already rides sessionStorage (src/stationSession.ts); the
 * activity rides beside it by exactly the same mechanism, in the same storage,
 * with the same lifetime, and is consumed at the same moment.
 *
 * WHAT AN ACTIVITY IS HERE. A LABEL — the event's own word for what is being
 * counted, which is already public: `wsfGoalPulse` publishes `unit` to an
 * unauthenticated display. It is not a fact about a person, it is not derived
 * from one, and nothing about who is holding the phone is stored, sent or
 * inferred by carrying it. It is a SELECTION, and it leaves with the journey:
 * the session storage key is cleared the moment the join finishes, and the
 * only other place it exists is the address bar of the page it was carried to.
 *
 * WHY A SCAN DOES NOT COUNT AS THE SELECTION. The same rule the queue is held
 * to — "a scan alone never enqueues" — applies one step earlier. A scan says
 * how somebody GOT here; it does not say what they have decided to do. So a
 * phone that arrives carrying an activity is SHOWN it and asked to confirm it,
 * and the two ways on do not exist on the page until it has. `initialSelection`
 * below is the whole of that rule, in one place, so a screen cannot get it
 * subtly wrong and no test has to infer it from a render.
 */

/** The query parameter an activity travels in, on `/join` and on `/event`. */
export const EVENT_ACTIVITY_PARAM = 'activity';

/**
 * Long enough for a unit somebody actually typed (wsfCreateGoal accepts 1..40)
 * with room to spare, short enough that no URL and no storage entry can be
 * used as a general-purpose carrier.
 */
export const ACTIVITY_LABEL_MAX = 64;

/**
 * A label a screen, a URL or a storage entry may carry — or null.
 *
 * Control characters go (a paste carries them invisibly), surrounding space
 * goes, runs of whitespace collapse, and anything past the cap makes the whole
 * value null rather than being silently truncated: a label that was cut in
 * half is a DIFFERENT label from the one somebody chose, and quietly
 * substituting it would be inventing a selection.
 */
export function readActivityLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  if (cleaned.length > ACTIVITY_LABEL_MAX) return null;
  return cleaned;
}

/**
 * A stable, boring identifier for one activity, used for a testID and for
 * React's key and for nothing else. It is never routed to, never stored and
 * never sent: `activityKey` may collapse two different labels onto the same
 * string, which is exactly why `eventActivities` disambiguates below instead
 * of trusting it to be unique.
 */
export function activityKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug === '' ? 'activity' : slug;
}

/** One thing a person can say they are here to do. */
export type EventActivity = {
  /** testID / React key only. Never a path and never stored. */
  key: string;
  /** What the person reads, and what they are agreeing they are doing. */
  label: string;
  /** True when this is the activity the scanned screen was running. */
  carried: boolean;
};

/**
 * What this event offers, in the order it is offered.
 *
 * The activity carried from the scanned screen comes first, because it is the
 * one the person is standing in front of. The event's own activity — the
 * goal's `unit`, as the server publishes it — follows, and folds into the
 * carried one when they are the same word, which is the ordinary case: a
 * station's code names its own goal's unit, so a scan and the pulse agree and
 * the person is shown ONE activity rather than the same activity twice.
 *
 * TODAY THIS LIST IS ONE ENTRY LONG in every reachable case, because an event
 * address names one goal and a goal counts one unit. It is a list anyway, and
 * deliberately: the moment an event's address can name more than one activity,
 * the selection this returns is already the selection the screen makes, and
 * nothing about the rule below has to be rewritten to allow it.
 */
export function eventActivities(opts: {
  unit?: string | null;
  carried?: string | null;
}): EventActivity[] {
  const carried = readActivityLabel(opts.carried);
  const unit = readActivityLabel(opts.unit);
  const out: EventActivity[] = [];
  const seen = new Set<string>();
  const push = (label: string, isCarried: boolean) => {
    const fold = label.toLowerCase();
    if (seen.has(fold)) return;
    seen.add(fold);
    out.push({ key: '', label, carried: isCarried });
  };
  if (carried) push(carried, true);
  if (unit) push(unit, false);

  // Keys last, so a collision between two different labels is resolved here
  // and cannot reach a testID as a duplicate.
  const used = new Set<string>();
  return out.map((activity) => {
    const base = activityKey(activity.label);
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}-${n++}`;
    used.add(key);
    return { ...activity, key };
  });
}

/**
 * WHICH ACTIVITY IS SELECTED THE MOMENT THE SCREEN OPENS — the one rule the
 * "only after activity selection" contract rests on.
 *
 * `null` means nothing is selected, so the screen offers no way on at all.
 *
 *   - A phone that CARRIED an activity from a scan selects nothing. It is
 *     shown what it scanned and asked to confirm it. A scan is how somebody
 *     got here, not what they decided, and the same refusal that keeps a scan
 *     out of the queue keeps it out of this.
 *   - An event with exactly ONE activity, opened WITHOUT a scan, stands
 *     selected. The person opened this event's own page themselves and there
 *     is no second thing to pick: asking them to tap the only answer would be
 *     ceremony, not a decision.
 *   - Anything else selects nothing.
 */
export function initialSelection(
  activities: readonly EventActivity[],
  carried: string | null | undefined
): string | null {
  if (readActivityLabel(carried)) return null;
  if (activities.length !== 1) return null;
  return activities[0]?.key ?? null;
}

/** The label behind a key, or null — so a screen never has to index an array
 * by hand and never shows a selection it cannot name. */
export function activityLabelFor(
  activities: readonly EventActivity[],
  key: string | null | undefined
): string | null {
  if (!key) return null;
  return activities.find((a) => a.key === key)?.label ?? null;
}

// ---- the words on screen ----------------------------------------------------
//
// Here rather than in the screen, for the same reason src/deviceMode.ts keeps
// its own: the spec and the UI read one literal, so a copy change cannot pass
// silently.

export const EVENT_ACTIVITY_HEADING = 'What are you here to do?';
export const EVENT_ACTIVITY_INTRO =
  'Pick the activity. Choosing it records nothing and puts nobody in a line.';
/** Shown against the activity a scan arrived with. It says plainly that the
 * scan did not decide anything. */
export const EVENT_ACTIVITY_SCANNED_NOTE =
  'This is the screen you scanned. Scanning is how you got here — tap it to say it is what you are doing.';

export const EVENT_CHOICE_HEADING = 'Where do you want to do it?';
export const EVENT_CHOICE_INTRO = 'Two ways, and you are in neither until you pick one.';

export const EVENT_CHOICE_PHONE_LABEL = 'Use my phone';
export const EVENT_CHOICE_PHONE_DESCRIPTION =
  'Do it now and enter the number you counted yourself. Nothing of yours goes on the screen in the room.';

export const EVENT_CHOICE_QUEUE_LABEL = 'Join the kiosk queue';
export const EVENT_CHOICE_QUEUE_DESCRIPTION =
  'Wait your turn at the screen in the room. You choose what it calls you first, and you are not in the line until you say so.';

/** The last line under the two, and the promise the queue keeps. */
export const EVENT_CHOICE_NOTE =
  'Opening either one puts nobody in a line. You are in the line only once you confirm the name the screen will call.';
