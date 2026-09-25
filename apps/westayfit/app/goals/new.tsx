import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createRef, useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { SecondaryLink, TextField } from '../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../src/featureFlags';
import {
  getFirebaseFirestore,
  getFirebaseFunctions,
  wsfIsStaging,
  wsfUsingEmulators,
} from '../../src/firebase';
import { type RepeatPolicy } from '../../src/contributionFlow';
import { isSubmittable, mapMovementSelection, type MovementKey } from '../../src/movementSelection';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { isValidTimeZone } from '../../src/ui/dates';
import { DateTimeField, type DateTimeFieldHandle } from '../../src/ui/DateTimeField';
import {
  ACTION_GREEN,
  CREAM,
  display,
  elevation,
  ERROR_RED,
  HAIRLINE,
  HERO_MUTED,
  kit,
  NAVY,
  ON_ACTION,
  ON_NAVY_RULE,
  OPTION_SELECTED_TINT,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
} from '../../src/ui/kit';
import { MovementPicker } from '../../src/ui/MovementPicker';
import { OptionGroup, OptionRow } from '../../src/ui/OptionRow';
import { formatCount } from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

// Where a community Champion starts a shared goal. The community page sends
// them here with the group it already knows (`?groupId=…`); they define the
// goal in one breath (name, target, what is counted), pick how long it runs,
// choose how often one member may take part, check the summary, and land on
// a "your goal is live" screen whose first action is the contribute page.
//
// This screen is HARD-GATED to the emulator + loopback host and to a staging
// build via `wsfUsingEmulators` / `wsfIsStaging` (double-gated inside
// firebase.ts). A production build cannot reach the form even if someone
// navigates the URL directly. The environment it writes into is carried as a
// non-visual `data-environment` attribute on the form, never as text a
// Champion reads; the community it belongs to travels the same way
// (`data-group-id`), never as an id on the page.
//
// Uses `wsfCreateGoal` (E4-A1) for the goal itself — the same callable the
// browser specs drive. The request shape is unchanged: ISO instants for the
// start and end, the IANA zone, and the repeat policy.

type CreatedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  communityGroupId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  repeatPolicy: RepeatPolicy;
};

type Duration = '1w' | '2w' | '1m' | 'custom';

const DURATIONS: ReadonlyArray<{ key: Duration; label: string; description: string }> = [
  { key: '1w', label: '1 week', description: 'Seven days from the start.' },
  { key: '2w', label: '2 weeks', description: 'Fourteen days from the start.' },
  { key: '1m', label: '1 month', description: 'The same day next month.' },
  { key: 'custom', label: 'Custom', description: 'Choose the exact start and end.' },
];

const REPEAT_OPTIONS: ReadonlyArray<{ key: RepeatPolicy; label: string; description: string }> = [
  {
    key: 'once',
    label: 'One contribution per member',
    description: 'Each member records one contribution toward this goal.',
  },
  {
    key: 'multiple',
    label: 'Members can contribute again',
    description: 'Each member can record as many contributions as they like while the goal is open.',
  },
];

// Names the environment this screen is actually writing into. Machine-readable
// only (a data attribute on the form); it never renders as text.
const SYNTHETIC_LABEL = wsfIsStaging ? 'STAGING SYNTHETIC TEST' : 'LOCAL SYNTHETIC TEST';

const FALLBACK_COMMUNITY_NAME = 'Your community';
const FALLBACK_TIME_ZONE = 'America/New_York';

// A zone Intl names awkwardly reads better as its place. Arizona keeps
// standard time all year, which Intl calls "Mountain Standard Time"; beside
// "Mountain Time" that reads as a duplicate, so it is named for the place.
const ZONE_LABELS: Readonly<Record<string, string>> = { 'America/Phoenix': 'Arizona Time' };

// ---- dates: the datetime-local shape "2026-09-25T14:00", read in local time ----

const LOCAL_DATE_TIME =
  /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]\.?)?\s*$/;

/**
 * Reads a date-time control's value in the device's local time. The web
 * control always gives `YYYY-MM-DDTHH:mm`; the off-web fallback is typed, so
 * a space, seconds and a 12-hour clock are read too. Anything else —
 * including a calendar day that does not exist — comes back null.
 */
function parseLocalDateTime(text: string): Date | null {
  const m = LOCAL_DATE_TIME.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, meridiem] = m;
  let hour = Number(h);
  if (meridiem) {
    // 12-hour clock: 12 AM is midnight, 12 PM is noon, 13 PM is nothing.
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12;
    if (meridiem.toLowerCase() === 'p') hour += 12;
  }
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hour,
    Number(mi),
    s ? Number(s) : 0,
    0
  );
  if (Number.isNaN(date.getTime())) return null;
  // Reject values Date would silently roll over (Feb 30, 25:00).
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d) ||
    date.getHours() !== hour ||
    date.getMinutes() !== Number(mi)
  ) {
    return null;
  }
  return date;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "2026-09-25T14:00" — the value a datetime-local control holds. */
function formatLocalDateTime(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * The quarter hour just passed. The default start is "now" on a clean
 * quarter-hour boundary — never ahead of the clock, so a goal started with
 * a preset is open the moment it is created (wsfContribute refuses anything
 * before startsAt).
 */
function quarterHourFloor(d: Date): Date {
  const out = new Date(d.getTime());
  out.setSeconds(0, 0);
  out.setMinutes(Math.floor(out.getMinutes() / 15) * 15);
  return out;
}

/** The end a preset implies: the same clock time 1 or 2 weeks, or one calendar month, on. */
function addDuration(start: Date, duration: Exclude<Duration, 'custom'>): Date {
  const out = new Date(start.getTime());
  if (duration === '1m') {
    const day = out.getDate();
    out.setDate(1);
    out.setMonth(out.getMonth() + 1);
    // Jan 31 + 1 month is the last day of February, not March 3.
    const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, lastDay));
    return out;
  }
  out.setDate(out.getDate() + (duration === '1w' ? 7 : 14));
  return out;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * "today at 3:15 PM", "tomorrow at 3:15 PM", "Friday, Sep 25 at 3:15 PM" —
 * in the device's own time, which is how the chosen values are read.
 */
function describeMoment(d: Date, now: Date): string {
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(d, now)) return `today at ${time}`;
  if (sameLocalDay(d, tomorrow)) return `tomorrow at ${time}`;
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  }).format(d);
  return `${day} at ${time}`;
}

/**
 * The device's zone, when the platform can name it; otherwise the product
 * default. This is the creation zone: a Champion is never defaulted to a zone
 * their device does not report.
 */
function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim() ? tz : FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * A time zone in words: "Eastern Time", "United Kingdom Time", "Coordinated
 * Universal Time". The generic name is preferred (it does not flip between
 * standard and daylight); zones the platform can only name as an offset fall
 * back to the specific name, and a zone it cannot name at all reads as its
 * identifier with the underscores taken out.
 */
function zoneInWords(tz: string): string {
  const named = ZONE_LABELS[tz];
  if (named) return named;
  const plain = tz.replace(/_/g, ' ');
  const nameOf = (timeZoneName: 'long' | 'longGeneric'): string | null => {
    try {
      const part = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        // 'longGeneric' is newer than the lib typings; older engines ignore it.
        timeZoneName: timeZoneName as 'long',
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName');
      return part && part.value.trim() ? part.value : null;
    } catch {
      return null;
    }
  };
  const generic = nameOf('longGeneric');
  // A bare offset ("GMT", "GMT+00:00") is not a name; the specific name
  // ("Coordinated Universal Time") reads better when there is one.
  if (generic && !/^(GMT|UTC)([+-].*)?$/.test(generic)) return generic;
  return nameOf('long') ?? generic ?? plain;
}

/** "5,000 squats" — the goal as one phrase, numbers grouped for reading. */
function definitionPhrase(target: number, unit: string): string {
  return `${formatCount(target)} ${unit}`;
}

/** The whole number a target field holds, or null when it is not one yet. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function repeatLabel(policy: RepeatPolicy): string {
  return REPEAT_OPTIONS.find((o) => o.key === policy)?.label ?? '';
}

/**
 * WHAT THE CLIENT ACTUALLY KNOWS AFTER A FAILED CREATE.
 *
 * This used to be one sentence for every failure, and the two sentences it
 * chose between both ended in "try again". W7 photographed what that costs
 * (#434, evidence `e6a208a`): a request aborted before it was sent and a
 * request whose transaction COMMITTED before the response was lost render
 * the identical words, while the server holds zero goals in the first case
 * and one in the second. A Champion who obeys "try again" after the second
 * one ends up with two goals, two ids, one title.
 *
 * So the failure is classified instead, and the rule is the only one the
 * client can honestly apply: a code the server can ONLY have produced BEFORE
 * it wrote is a refusal, and everything else is unknown.
 *
 *   REFUSED — the server answered, and answered before the write. Every code
 *   below is raised by wsfCreateGoal ahead of, or inside but before, the
 *   `tx.set` in its transaction (functions-westayfit/src/index.ts). The
 *   screen may say plainly that no goal was created.
 *
 *   UNKNOWN — `unavailable`, `deadline-exceeded`, `internal`, `aborted`,
 *   `cancelled`, an unrecognised code, and anything that is not a
 *   FirebaseError at all. A transaction that throws after committing is
 *   indistinguishable here from one that never ran, so the screen says only
 *   that it could not confirm. It claims nothing in EITHER direction.
 *
 * Ambiguity resolves toward "we do not know" and never toward a claim. No
 * idempotency is invented to paper over it: `wsfCreateGoal` takes no attempt
 * key, and asking it for one is not this route's call to make.
 */
type Outcome =
  | {
      kind: 'refused';
      message: string;
      /**
       * Whether a SERVER produced this. The one refusal that does not come
       * from one is the guard for arriving with no community, and it may not
       * borrow the sentence about what the server did.
       */
      fromServer: boolean;
      /**
       * Whether repeating this exact request could ever succeed from this
       * page. A refusal the Champion CAN clear here — a value the form sent,
       * or a rate limit that lapses — keeps the submit control. One they
       * cannot (not signed in, unverified, not a Champion, no such community)
       * takes it away: leaving it would buy them a second copy of the same
       * sentence.
       */
      terminal: boolean;
    }
  | { kind: 'unknown' };

const REFUSAL_COPY: Readonly<Record<string, { message: string; terminal: boolean }>> = {
  'functions/unauthenticated': {
    message: 'Please sign in again, then start the goal.',
    terminal: true,
  },
  'functions/failed-precondition': {
    message: 'Verify your email address before starting a goal.',
    terminal: true,
  },
  'functions/permission-denied': {
    message: 'Only a Champion of this community can start a goal here.',
    terminal: true,
  },
  'functions/not-found': { message: "We couldn't find that community.", terminal: true },
  'functions/invalid-argument': {
    message: "Something about this goal didn't look right. Check the details and try again.",
    terminal: false,
  },
  'functions/resource-exhausted': {
    message: 'Too many goals were started in a short time. Wait a moment and try again.',
    terminal: false,
  },
};

function classifyFailure(e: unknown): Outcome {
  if (e instanceof FirebaseError) {
    const known = REFUSAL_COPY[e.code];
    if (known) return { kind: 'refused', fromServer: true, ...known };
  }
  return { kind: 'unknown' };
}

// The fields a submit can refuse, in the order they sit on the page: the
// first one refused is the one the page focuses and scrolls to.
const FIELD_ORDER = ['title', 'target', 'unit', 'starts', 'ends', 'timezone'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

export default function NewGoalPage() {
  const { ready, user } = useWsfAuth();
  // The short phone is the one this form is worst on, because it is the
  // longest form in the product. The only thing it changes is type size: the
  // heading drops a tier so the definition line clears the fold. Nothing is
  // hidden, moved or removed at any width.
  const { height: viewportHeight } = useWindowDimensions();
  const shortPhone = viewportHeight > 0 && viewportHeight < 700;
  // The real path: a champion arrives from their community page, which passes
  // the group it already knows. Package C's job was to make that path work;
  // seeding a synthetic community from inside the product screen was a test
  // scaffold and has moved to isolated test setup
  // (apps/westayfit/tests-e2e/helpers/seed.ts).
  const params = useLocalSearchParams<{ groupId?: string }>();
  // The only way a community reaches this screen: the route the community
  // page opened. Nothing on the page asks for or prints an id.
  const groupIdParam = typeof params.groupId === 'string' ? params.groupId.trim() : '';
  const userId = user?.uid ?? null;

  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  // MOVEMENT-PILLS-1. Empty means "Something else": the free-text unit decides,
  // exactly as before. The typed draft is kept while a movement is chosen and
  // comes back with Something else. One movement at a time: the existing goal
  // contract persists only one (Director #456 `5834379218`); see
  // src/movementSelection.ts.
  const [movements, setMovements] = useState<MovementKey[]>([]);
  // The start is "now" on the quarter hour, fixed when the page opens so the
  // line the Champion reads is the instant that is sent. Custom lets them
  // choose both ends; a preset derives the end from the start.
  const [startsAt, setStartsAt] = useState(() => formatLocalDateTime(quarterHourFloor(new Date())));
  const [endsAt, setEndsAt] = useState('');
  const [duration, setDuration] = useState<Duration>('1w');
  // The times a Champion chooses are read in their device's zone, so that is
  // the zone the goal is created in: the words on this page, the instants sent
  // to the server and the stored zone can never disagree. There is nothing to
  // pick, so there is no picker.
  const [timezone] = useState(deviceTimeZone);
  // The Champion's decision about how often one member may contribute. 'once'
  // is the default here for the same reason it is the default on the server:
  // it is the conservative answer, and a goal that takes repeat contributions
  // should be a choice somebody made.
  const [repeatPolicy, setRepeatPolicy] = useState<RepeatPolicy>('once');
  // The community's name, read from the document Community Home already
  // reads. Until it arrives (or if it never does) the page says "Your
  // community" — never an id.
  const [communityName, setCommunityName] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedGoal | null>(null);

  // What a refused submit focuses and scrolls to: the input itself, and the
  // block (label, input, message) around it.
  const scrollRef = useRef<ScrollView>(null);

  const titleRef = useRef<TextInput>(null);
  const targetRef = useRef<TextInput>(null);
  const unitRef = useRef<TextInput>(null);
  const startsRef = useRef<DateTimeFieldHandle>(null);
  const endsRef = useRef<DateTimeFieldHandle>(null);
  const anchorRefs = useRef({
    title: createRef<View>(),
    target: createRef<View>(),
    unit: createRef<View>(),
    starts: createRef<View>(),
    ends: createRef<View>(),
    timezone: createRef<View>(),
  }).current;

  useEffect(() => {
    if (!wsfAuthEnabled || !userId || !groupIdParam) return;
    if (!wsfUsingEmulators && !wsfIsStaging) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getFirebaseFirestore(), 'wsfCommunityGroups', groupIdParam));
        if (cancelled || !snap.exists()) return;
        const name = (snap.data() as { displayName?: unknown }).displayName;
        if (typeof name === 'string' && name.trim()) setCommunityName(name.trim());
      } catch {
        // The page reads "Your community"; the callable still knows the group.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, groupIdParam]);

  const now = new Date();
  const startsDate = parseLocalDateTime(startsAt);
  const endsDate =
    duration === 'custom'
      ? parseLocalDateTime(endsAt)
      : startsDate
        ? addDuration(startsDate, duration)
        : null;
  // The one refused window that still reads as a date: an end at or before
  // the start. Derived, so the summary below can never disagree with the
  // check onSubmit runs.
  const windowInvalid =
    startsDate != null && endsDate != null && endsDate.getTime() <= startsDate.getTime();
  const targetNumber = wholeNumber(target);
  const selection = mapMovementSelection(movements);
  // The unit the goal will record: the movement's own when one is chosen, the
  // typed words under Something else. A choice the contract cannot persist has
  // no unit at all, so nothing downstream can read one.
  const trimmedUnit =
    selection.kind === 'none' ? unit.trim() : isSubmittable(selection) ? selection.unit : '';
  const selectionBlocked = selection.kind === 'mixed' || selection.kind === 'several';
  const definition = targetNumber !== null && trimmedUnit ? definitionPhrase(targetNumber, trimmedUnit) : null;
  const communityLabel = communityName ?? FALLBACK_COMMUNITY_NAME;

  const clearFieldError = useCallback((key: FieldKey) => {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  const chooseDuration = useCallback(
    (next: Duration) => {
      setDuration(next);
      clearFieldError('starts');
      clearFieldError('ends');
      if (next !== 'custom' && !parseLocalDateTime(startsAt)) {
        // A start cleared under Custom would otherwise ride along invisibly
        // under a preset and stop the submit with no message. A preset
        // starts now.
        setStartsAt(formatLocalDateTime(quarterHourFloor(new Date())));
      }
      if (next === 'custom') {
        // Custom opens on the end the current preset implied, so the
        // Champion edits a real date rather than an empty box.
        setEndsAt((prev) => {
          if (prev.trim()) return prev;
          const start = parseLocalDateTime(startsAt);
          return start ? formatLocalDateTime(addDuration(start, duration === 'custom' ? '1w' : duration)) : '';
        });
      }
    },
    [clearFieldError, duration, startsAt]
  );

  /** Focus the first refused field and bring its block to the top of the view. */
  const revealField = useCallback(
    (key: FieldKey) => {
      const focusable = {
        title: titleRef,
        target: targetRef,
        unit: unitRef,
        starts: startsRef,
        ends: endsRef,
        timezone: null,
      }[key];
      focusable?.current?.focus();
      const anchor = anchorRefs[key].current;
      const scroll = scrollRef.current;
      if (!anchor || !scroll) return;
      const content = scroll.getInnerViewNode();
      if (!content) return;
      anchor.measureLayout(
        content,
        (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: true }),
        () => {}
      );
    },
    [anchorRefs]
  );

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    // A new attempt clears the previous answer. Nothing here retries on the
    // Champion's behalf: every create on this page is a press they made.
    setOutcome(null);

    const errors: FieldErrors = {};

    // The form only renders with a community; this is a guard, not a state.
    const trimmedGroupId = groupIdParam;
    if (!trimmedGroupId) {
      setOutcome({
        kind: 'refused',
        fromServer: false,
        message: 'Open this page from your community to start a goal.',
        terminal: true,
      });
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      errors.title = 'Give your goal a name.';
    } else if (trimmedTitle.length < 2 || trimmedTitle.length > 120) {
      errors.title = 'Use a name between 2 and 120 characters.';
    }

    const trimmedTarget = target.trim();
    const targetNum = /^[0-9]+$/.test(trimmedTarget) ? Number.parseInt(trimmedTarget, 10) : Number.NaN;
    if (!Number.isInteger(targetNum) || targetNum < 1) {
      errors.target = 'Enter a whole number greater than zero.';
    } else if (targetNum > 100_000_000) {
      errors.target = 'Keep the target at 100,000,000 or less.';
    }

    const chosen = mapMovementSelection(movements);
    const trimmedUnit =
      chosen.kind === 'none' ? unit.trim() : isSubmittable(chosen) ? chosen.unit : '';
    if (chosen.kind === 'mixed' || chosen.kind === 'several') {
      // Nothing the contract cannot persist is ever sent: the same sentence
      // the picker already shows, as the field's own error.
      errors.unit = chosen.message;
    } else if (!trimmedUnit) {
      errors.unit = "Say what you're counting, like squats or miles.";
    } else if (trimmedUnit.length > 40) {
      errors.unit = 'Keep the unit to 40 characters or fewer.';
    }
    const activityGuideKey = isSubmittable(chosen) ? chosen.activityGuideKey : undefined;

    const start = parseLocalDateTime(startsAt);
    if (!start) {
      errors.starts = 'Choose when the goal starts.';
    }
    const end =
      duration === 'custom' ? parseLocalDateTime(endsAt) : start ? addDuration(start, duration) : null;
    if (duration === 'custom' && !end) {
      errors.ends = 'Choose when the goal ends.';
    } else if (start && end && end.getTime() <= start.getTime()) {
      errors.ends = 'The end must be after the start.';
    }

    // Nothing in the UI can change the zone, so this only guards against a
    // device that names a zone the platform itself cannot read back.
    const trimmedTz = timezone.trim();
    if (!trimmedTz || !isValidTimeZone(trimmedTz)) {
      errors.timezone = "We can't read your device's time zone, so this goal can't be started here.";
    }

    if (Object.keys(errors).length > 0 || !start || !end) {
      setFieldErrors(errors);
      const first = FIELD_ORDER.find((key) => errors[key]);
      if (first) revealField(first);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const fn = httpsCallable<
        {
          title: string;
          target: number;
          unit: string;
          communityGroupId: string;
          startsAt: string;
          endsAt: string;
          timezone: string;
          repeatPolicy: RepeatPolicy;
          activityGuideKey?: string;
        },
        { goalId: string }
      >(getFirebaseFunctions(), 'wsfCreateGoal');
      const result = await fn({
        title: trimmedTitle,
        target: targetNum,
        unit: trimmedUnit,
        communityGroupId: trimmedGroupId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timezone: trimmedTz,
        repeatPolicy,
        // Only when a movement was chosen: a typed unit sends no key, so its
        // goal is byte-identical to one created before this field was used.
        ...(activityGuideKey ? { activityGuideKey } : {}),
      });
      setCreated({
        goalId: result.data.goalId,
        title: trimmedTitle,
        target: targetNum,
        unit: trimmedUnit,
        communityGroupId: trimmedGroupId,
        startsAt: start,
        endsAt: end,
        timezone: trimmedTz,
        repeatPolicy,
      });
    } catch (e) {
      setOutcome(classifyFailure(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    groupIdParam,
    title,
    target,
    unit,
    movements,
    startsAt,
    endsAt,
    duration,
    timezone,
    repeatPolicy,
    submitting,
    revealField,
  ]);

  // Hard gate. Production bundles that somehow route here render a refusal
  // panel and never call any callable — no accidental production writes.
  //
  // WIDENED, NOT REMOVED. The gate now admits two synthetic environments: the
  // local emulator suite, and a staging build. It still refuses production,
  // and `wsfIsStaging` is only true when resolveStagingConfig verified a
  // COMPLETE config for a project that is not `goarrive` (src/stagingEnv.ts)
  // — so this cannot be turned on by setting one env var, and it cannot be
  // turned on at all for a build pointed at production.
  //
  // Worth stating because it is load-bearing for how much this gate is worth:
  // the restriction is CLIENT-SIDE ONLY. wsfCreateGoal has no environment,
  // origin or hostname condition — it checks auth, a verified email, and an
  // active foundingChampion membership, and nothing else. This screen is
  // therefore a guard against accidental production writes, not a security
  // boundary against deliberate ones.
  if (!wsfUsingEmulators && !wsfIsStaging) {
    return (
      <Page>
        <View style={kit.card} testID="wsf-new-goal-gated-off">
          <Text style={kit.cardTitle}>Starting a goal isn't available here yet</Text>
          <Text style={kit.body}>
            Goals can be started from your community once this feature is switched on for
            your build.
          </Text>
        </View>
      </Page>
    );
  }

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="New goal" testID="wsf-new-goal-disabled" />;
  }
  if (!ready) {
    return (
      <Page>
        <Text style={kit.statusText}>Loading…</Text>
      </Page>
    );
  }
  if (!user) {
    return (
      <Page groupId={groupIdParam}>
        <View>
          <Text style={kit.heading}>Sign in to start a goal</Text>
          <Text style={[kit.intro, styles.intro]}>
            Only a signed-in Champion can start a goal for their community.
          </Text>
        </View>
        <SecondaryLink href="/signin" label="Sign in" />
      </Page>
    );
  }

  if (created) {
    // String hrefs, as Community Home builds them: the anchor resolves to the
    // same `/contribute/<goalId>` the object form produced.
    //
    // THE ID HERE IS THE SERVER'S, and only the server's. It came back in the
    // callable's response and is held for as long as this receipt is in
    // memory. Nothing infers it from the title and nothing looks for a goal
    // whose name happens to match — a reload loses the receipt, and the way
    // back after that is the community, not a guess.
    const contributeHref = `/contribute/${created.goalId}`;
    const displayHref = `/display/${created.goalId}`;
    const communityHref = `/community/${created.communityGroupId}`;
    return (
      <Page
        // A key of its own, so this is a NEW scrolling element rather than the
        // form's reused one. Without it the browser keeps the offset the form
        // was scrolled to, and on a 360 px phone the Champion lands below
        // "Your goal is live" instead of on it.
        key="goal-created"
        testID="wsf-new-goal-created"
        // The ids the browser specs read, as data attributes on the container
        // (react-native-web renders dataSet as data-goal-id / data-group-id).
        // Nothing on the page prints them.
        dataSet={{ 'goal-id': created.goalId, 'group-id': created.communityGroupId }}
      >
        <View>
          <Text style={kit.eyebrow}>{communityLabel}</Text>
          <Text
            style={[shortPhone ? kit.headingCompact : kit.heading, styles.headingAfterEyebrow]}
          >
            Your goal is live
          </Text>
          <Text style={[kit.intro, styles.intro]}>
            Send it to your members and put it on a screen.
          </Text>
        </View>
        {/*
          The goal that now exists, as one object: what it is, when it runs,
          and the one next useful action inside it. The phrase is the TARGET,
          not a total — it is drawn large because it is the thing the
          community agreed to, and there is no ratio, bar or count anywhere on
          this screen. Nobody has contributed yet, so a Living WE here would
          be a picture of a number that does not exist.
        */}
        <View style={styles.livePanel}>
          <Text style={styles.liveEyebrow}>NOW OPEN</Text>
          <Text style={styles.liveTitle}>{created.title}</Text>
          <Text style={[shortPhone ? display.md : display.lg, styles.livePhrase]}>
            {definitionPhrase(created.target, created.unit)}
          </Text>
          <View style={styles.liveRule} />
          <Text style={styles.liveMeta}>
            Starts {describeMoment(created.startsAt, now)} · Ends {describeMoment(created.endsAt, now)}
          </Text>
          <Text style={styles.liveMeta}>
            {zoneInWords(created.timezone)} · {repeatLabel(created.repeatPolicy)}
          </Text>
          {/*
            The one next useful action, and the only control on this screen
            that opens the contribute page. It is a ButtonLink, so the primary
            itself carries the href.
          */}
          <ButtonLink
            href={contributeHref}
            style={styles.primaryAction}
            textStyle={styles.primaryActionText}
            testID="wsf-new-goal-goto-contribute"
            label="Open the contribute page"
          />
          <Text style={styles.liveCaption}>
            Where members record what they did and watch the shared total grow.
          </Text>
        </View>
        {/*
          The two remaining ways on, as a plain pair. The card that used to
          wrap one of them was a surface for a single link.
        */}
        <ButtonLink
          href={displayHref}
          style={kit.secondaryButton}
          textStyle={kit.secondaryButtonText}
          testID="wsf-new-goal-display-link"
          label="Show on a big screen"
        />
        <Text style={kit.caption}>
          A live view of the total for a TV or projector where everyone can see it.
        </Text>
        <ButtonLink
          href={communityHref}
          style={kit.secondaryButton}
          textStyle={kit.secondaryButtonText}
          testID="wsf-new-goal-back"
          label="Back to community"
        />
      </Page>
    );
  }

  if (!groupIdParam) {
    // Opened without a community (a typed URL, a stale bookmark). There is
    // nothing to type here — the community page is the way in.
    return (
      <Page testID="wsf-new-goal-form" dataSet={{ environment: SYNTHETIC_LABEL, 'group-id': '' }}>
        <View testID="wsf-new-goal-no-community">
          <Text style={kit.headingCompact}>Choose a community before starting a goal.</Text>
          <Text style={[kit.intro, styles.intro]}>
            Open the community the goal is for, then tap Start a goal there.
          </Text>
        </View>
        {/*
          The primary action of this state, so it wears the action green like
          the route's other three. It was left on the progress green while the
          F6 ruling named only the three captured CTAs; the Director closed
          that gap on the pixel pass — this is plainly the primary action here.
        */}
        <ButtonLink
          href="/"
          style={styles.primaryAction}
          textStyle={styles.primaryActionText}
          testID="wsf-new-goal-home"
          label="Go to your communities"
        />
      </Page>
    );
  }

  const durationNote = DURATIONS.find((d) => d.key === duration)?.description ?? '';
  const unresolved = outcome?.kind === 'unknown';
  // A refusal the Champion cannot clear from this page takes the control away
  // with it: the server would answer the identical request the same way.
  const canSubmit = !(outcome?.kind === 'refused' && outcome.terminal);
  const communityHref = `/community/${groupIdParam}`;

  return (
    <Page
      testID="wsf-new-goal-form"
      groupId={groupIdParam}
      scrollRef={scrollRef}
      // The community this goal is for, as data-group-id on the form (the
      // specs read it there); the Champion reads its name.
      dataSet={{ environment: SYNTHETIC_LABEL, 'group-id': groupIdParam }}
    >
      <View>
        <Text style={kit.eyebrow} testID="wsf-new-goal-community">
          {communityLabel}
        </Text>
        <Text style={[shortPhone ? kit.headingCompact : kit.heading, styles.headingAfterEyebrow]}>
          Start a goal
        </Text>
        <Text style={[shortPhone ? kit.body : kit.intro, styles.intro]}>
          Set what your community will do together. Every contribution adds to one shared total.
        </Text>
      </View>

      {/*
        THE SPINE. The same three decisions and the same review that were
        here before, in the same order and the same words — joined by a
        numbered rule instead of stacked as four identically-weighted cards.
        It is still ONE page and one scroll: nothing collapses, nothing
        paginates, and no step hides another. What it buys is that a Champion
        can see how many decisions there are and which one they are in.
      */}
      <Step n="1" title="The goal" meta={`Name it, set the total, and say what you're counting — together they read like "5,000 squats" or "300 miles".`}>
        <View ref={anchorRefs.title}>
          <Text style={kit.fieldLabel}>Goal name</Text>
          <TextField
            ref={titleRef}
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              clearFieldError('title');
            }}
            placeholder="e.g. September squat challenge"
            editable={!submitting}
            testID="wsf-new-goal-title"
          />
          <FieldError message={fieldErrors.title} testID="wsf-new-goal-title-error" />
        </View>
        {/*
          The number and the unit read as one sentence, so they sit on one
          line where the words allow it and stack when they do not.
        */}
        <View style={styles.pair}>
          <View style={styles.pairTarget} ref={anchorRefs.target}>
            <Text style={kit.fieldLabel}>Target</Text>
            <TextField
              ref={targetRef}
              value={target}
              onChangeText={(v) => {
                setTarget(v);
                clearFieldError('target');
              }}
              placeholder="e.g. 5000"
              keyboardType="number-pad"
              inputMode="numeric"
              editable={!submitting}
              testID="wsf-new-goal-target"
            />
            <FieldError message={fieldErrors.target} testID="wsf-new-goal-target-error" />
          </View>
          <View style={styles.pairUnit} ref={anchorRefs.unit}>
            <Text style={kit.fieldLabel}>What you&apos;re counting</Text>
            {movements.length === 0 ? (
              <TextField
                ref={unitRef}
                value={unit}
                onChangeText={(v) => {
                  setUnit(v);
                  clearFieldError('unit');
                }}
                placeholder="e.g. squats, or pick one below"
                editable={!submitting}
                testID="wsf-new-goal-unit"
              />
            ) : (
              // Chosen by the pills above: shown, not typed. Something else
              // brings the typed draft back untouched.
              <Text style={styles.unitChosen} testID="wsf-new-goal-unit-chosen">
                {trimmedUnit || 'Choose one movement'}
              </Text>
            )}
            <FieldError message={fieldErrors.unit} testID="wsf-new-goal-unit-error" />
          </View>
        </View>
        {/*
          THE SENTENCE THE TWO FIELDS EXIST TO MAKE, at the kit's display tier
          rather than at field-label weight. It is the thing being made, and
          it is the only thing on this screen at this size.
        */}
        {definition ? (
          <View style={styles.payoff}>
            <Text style={[display.md, styles.payoffText]} testID="wsf-new-goal-definition">
              {definition}
            </Text>
          </View>
        ) : null}
        {/*
          MOVEMENT-PILLS-1. One supported movement, or Something else — and
          then the typed unit beside the target decides, as it always did.
          Anything the goal contract cannot persist says so here, before any
          submit, and the submit stays off until it is resolved.

          BELOW THE GOAL PHRASE, deliberately. The accepted target's claim is
          that the phrase is on screen with the fields that make it at 390×640
          as well as 390×844; three rows of 44 px pills above it pushed it off
          a 640 px screen. Here, a choice updates the phrase just above it.
        */}
        <View style={styles.movements} testID="wsf-new-goal-movements-block">
          <MovementPicker
            selected={movements}
            onChange={(next) => {
              setMovements(next);
              clearFieldError('unit');
            }}
            mode="single"
            somethingElse={{
              selected: movements.length === 0,
              onPress: () => {
                setMovements([]);
                clearFieldError('unit');
              },
            }}
            hint="Pick a movement, or Something else to name your own."
            disabled={submitting}
            label="Movements"
            testID="wsf-new-goal-movements"
          />
          {selection.kind === 'mixed' || selection.kind === 'several' ? (
            <Text
              style={kit.errorText}
              accessibilityRole={'alert' as never}
              testID="wsf-new-goal-movements-blocked"
            >
              {selection.message}
            </Text>
          ) : selection.kind === 'individual' ? (
            <Text style={kit.caption} testID="wsf-new-goal-movements-count">
              {selection.countSentence}
            </Text>
          ) : null}
        </View>
      </Step>

      <Step n="2" title="When">
        <Text style={kit.fieldLabel}>How long</Text>
        {/*
          FOUR PILLS, NOT FOUR ROWS. The same four choices with the same
          labels and the same 44 px of hit target, in the height four option
          rows spent on describing three options nobody picked. The chosen
          one's description is kept, once, underneath. Selection is stated as
          aria-checked on a radio, never by colour alone.
        */}
        <View
          style={styles.pills}
          accessibilityRole="radiogroup"
          accessibilityLabel="How long"
          testID="wsf-new-goal-duration"
        >
          {DURATIONS.map((d) => (
            <DurationPill
              key={d.key}
              label={d.label}
              selected={duration === d.key}
              disabled={submitting}
              onPress={() => chooseDuration(d.key)}
              testID={`wsf-new-goal-duration-${d.key}`}
            />
          ))}
        </View>
        {durationNote ? <Text style={kit.caption}>{durationNote}</Text> : null}
        {duration === 'custom' ? (
          <>
            <View ref={anchorRefs.starts}>
              <Text style={kit.fieldLabel}>Starts</Text>
              <DateTimeField
                ref={startsRef}
                value={startsAt}
                onChange={(v) => {
                  setStartsAt(v);
                  clearFieldError('starts');
                  clearFieldError('ends');
                }}
                editable={!submitting}
                accessibilityLabel="Starts"
                testID="wsf-new-goal-starts-at"
              />
              <FieldError message={fieldErrors.starts} testID="wsf-new-goal-starts-error" />
            </View>
            <View ref={anchorRefs.ends}>
              <Text style={kit.fieldLabel}>Ends</Text>
              <DateTimeField
                ref={endsRef}
                value={endsAt}
                onChange={(v) => {
                  setEndsAt(v);
                  clearFieldError('ends');
                }}
                editable={!submitting}
                accessibilityLabel="Ends"
                testID="wsf-new-goal-ends-at"
              />
            </View>
          </>
        ) : null}
        <View style={styles.window}>
          {/*
            Under Custom the control above states the start, so the derived
            line is not drawn as well: they are alternatives, not companions.
            The ends line is rendered in both modes.
          */}
          {duration !== 'custom' && startsDate ? (
            <Text style={kit.body} testID="wsf-new-goal-starts-line">
              Starts {describeMoment(startsDate, now)}
            </Text>
          ) : null}
          {endsDate ? (
            <Text style={kit.body} testID="wsf-new-goal-ends-line">
              Ends {describeMoment(endsDate, now)}
            </Text>
          ) : null}
          <FieldError message={fieldErrors.ends} testID="wsf-new-goal-ends-error" />
        </View>
        <View ref={anchorRefs.timezone}>
          <Text style={[kit.caption, styles.zoneText]} testID="wsf-new-goal-timezone-line">
            Times are in {zoneInWords(timezone)}
          </Text>
          <FieldError message={fieldErrors.timezone} testID="wsf-new-goal-timezone-error" />
        </View>
      </Step>

      {/*
        The repeat choice keeps the full option row in both states. It is the
        one decision on this page with a consequence for every member, so it
        keeps its description whether or not it is the chosen one — and there
        are still exactly two.
      */}
      <Step n="3" title="How members take part" last>
        <Text style={kit.fieldLabel}>How often can one member contribute?</Text>
        <OptionGroup
          accessibilityLabel="How often can one member contribute?"
          testID="wsf-new-goal-repeat"
        >
          {REPEAT_OPTIONS.map((o) => (
            <OptionRow
              key={o.key}
              label={o.label}
              description={o.description}
              selected={repeatPolicy === o.key}
              onPress={() => setRepeatPolicy(o.key)}
              disabled={submitting}
              testID={`wsf-new-goal-repeat-${o.key}`}
            />
          ))}
        </OptionGroup>
      </Step>

      {outcome ? <OutcomeBanner outcome={outcome} communityHref={communityHref} /> : null}

      {/*
        THE CHECK AND THE COMMIT, AS ONE OBJECT. The same seven rows and the
        same words as before, on the one navy surface on the page, with the
        control that starts the goal inside it. A Champion cannot scroll the
        thing they are confirming away from the thing that confirms it, and
        the last row is no longer underneath the raised MOVE circle.
      */}
      <View style={styles.commit} testID="wsf-new-goal-summary">
        <Text style={styles.commitTitle}>Check it over</Text>
        <Text style={styles.commitMeta}>This is what your community will see.</Text>
        <View style={styles.commitRows}>
          <SummaryRow label="Community" value={communityLabel} />
          <SummaryRow label="Goal" value={title.trim() || 'Not named yet'} />
          <SummaryRow label="Target" value={definition ?? 'Not set yet'} />
          {isSubmittable(selection) ? (
            <SummaryRow label="Counting" value={selection.countSentence} />
          ) : null}
          <SummaryRow
            label="Starts"
            value={startsDate ? describeMoment(startsDate, now) : 'Choose a start'}
          />
          {/*
            An end at or before the start is the one configuration the form
            refuses that still produces a readable date. Saying it back under
            "This is what your community will see" would confirm a goal that
            cannot be created, so the row states the problem instead. It stays
            in the row's own voice, not red: the red message belongs under the
            field, after a submit attempt.
          */}
          <SummaryRow
            label="Ends"
            value={
              endsDate
                ? windowInvalid
                  ? `${describeMoment(endsDate, now)} — must be after the start`
                  : describeMoment(endsDate, now)
                : 'Choose an end'
            }
          />
          <SummaryRow label="Time zone" value={zoneInWords(timezone)} />
          <SummaryRow label="Members" value={repeatLabel(repeatPolicy)} />
        </View>
        {canSubmit ? (
          <>
            {/*
              After an unknown result this is NOT the same button. It says
              what it would start, it is drawn as a secondary rather than the
              one green action on the screen, and the consequence sits
              directly under it. Nothing retries on the Champion's behalf.
            */}
            <Pressable
              style={[
                unresolved ? styles.commitSecondary : styles.primaryAction,
                (submitting || selectionBlocked) && kit.primaryButtonDisabled,
              ]}
              onPress={onSubmit}
              // A choice with no contract to submit to; the reason is
              // already on screen under the pills.
              disabled={submitting || selectionBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting || selectionBlocked }}
              testID="wsf-new-goal-submit"
            >
              <Text style={unresolved ? styles.commitSecondaryText : styles.primaryActionText}>
                {submitting ? 'Starting…' : unresolved ? 'Start another goal' : 'Start this goal'}
              </Text>
            </Pressable>
            {unresolved ? (
              <Text style={styles.commitNote}>
                This starts a new, separate goal. If the first one was created, your community
                will have two.
              </Text>
            ) : null}
          </>
        ) : (
          <ButtonLink
            href={communityHref}
            style={styles.commitSecondary}
            textStyle={styles.commitSecondaryText}
            testID="wsf-new-goal-refused-back"
            label="Back to community"
          />
        )}
      </View>
    </Page>
  );
}

/**
 * One section of the form on the spine: a numbered marker, a rule down to the
 * next one, and the section's own surface. The number and the rule are the
 * whole of the navigation — nothing here collapses or hides.
 */
function Step({
  n,
  title,
  meta,
  children,
  last,
}: {
  n: string;
  title: string;
  meta?: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.spine}>
        <View style={styles.spineDot}>
          <Text style={styles.spineDotText}>{n}</Text>
        </View>
        {last ? null : <View style={styles.spineRule} />}
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        {meta ? <Text style={styles.stepMeta}>{meta}</Text> : null}
        <View style={styles.stepCard}>{children}</View>
      </View>
    </View>
  );
}

/**
 * One duration choice. A pill rather than a row, but the same control
 * underneath: `role="radio"` with `aria-checked`, so the selected state is
 * stated to a screen reader and to anyone who cannot rely on colour, exactly
 * as OptionRow states it. The raw attribute is there because browsers read
 * the DOM rather than accessibilityState.
 */
function DurationPill({
  label,
  selected,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[kit.pill, selected ? kit.pillSelected : null, disabled ? styles.pillDisabled : null]}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      {...({ 'aria-checked': selected } as Record<string, unknown>)}
    >
      <Text style={[kit.pillText, selected ? kit.pillTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * What the page says when a create did not produce a goal — and the whole
 * point of it is that those are TWO different things.
 *
 * A REFUSAL may speak about the server's state, because the server answered
 * and answered before it wrote. An UNKNOWN result may not, in either
 * direction: it does not say nothing was created, it does not say anything
 * was, and it does not promise that trying again is free. It offers the one
 * action that can actually resolve it — the community's own page, which
 * lists the goal if there is one — and leaves the second create to a
 * deliberate press further down.
 */
function OutcomeBanner({ outcome, communityHref }: { outcome: Outcome; communityHref: string }) {
  if (outcome.kind === 'refused') {
    return (
      <View style={[styles.banner, styles.bannerRefused]}>
        <Text style={styles.bannerTitleRefused}>We couldn&rsquo;t start your goal.</Text>
        <Text style={styles.bannerBody} testID="wsf-new-goal-error">
          {outcome.fromServer
            ? `${outcome.message} The server refused this request, so no goal was created.`
            : outcome.message}
        </Text>
      </View>
    );
  }
  return (
    <>
      <View style={[styles.banner, styles.bannerUnknown]}>
        {/*
          Amber, not red. An unknown outcome is not a failure, and colouring
          it as one is its own false claim.
        */}
        <Text style={styles.bannerTitleUnknown}>
          We couldn&rsquo;t confirm your goal was created.
        </Text>
        <Text style={styles.bannerBody} testID="wsf-new-goal-error">
          It may have been created anyway. Starting another one could create a duplicate.
        </Text>
      </View>
      {/*
        Community-level on purpose. No goal id is guessed from the title and
        no goal whose name happens to match is opened: the community page
        lists what actually exists, and the Champion reads it.
      */}
      <ButtonLink
        href={communityHref}
        style={styles.primaryAction}
        textStyle={styles.primaryActionText}
        testID="wsf-new-goal-check-goals"
        label="Check community goals"
      />
    </>
  );
}

/** One inline validation message, under the field it belongs to. */
function FieldError({ message, testID }: { message?: string; testID: string }) {
  if (!message) return null;
  return (
    <Text style={kit.errorText} testID={testID}>
      {message}
    </Text>
  );
}

/**
 * One label/value line of the review; the value wraps under the label when
 * narrow. Cream on navy now, because the review is the one navy surface on
 * the page — same rows, same words, read against a different ground.
 */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
    </View>
  );
}

/**
 * The page every state of this screen sits on: the scrolling cream page,
 * the wordmark chrome (with a quiet way back to the community when we know
 * which one), then the state's own content in the column. The state's testID
 * stays on the column, a visible element, so the specs that wait for
 * `wsf-new-goal-form` / `wsf-new-goal-created` see what they saw. `dataSet`
 * carries machine-readable values (ids, environment) as data-* attributes
 * on that same column.
 */
function Page({
  children,
  testID,
  groupId,
  dataSet,
  scrollRef,
}: {
  children: ReactNode;
  testID?: string;
  groupId?: string;
  dataSet?: Record<string, string>;
  scrollRef?: Ref<ScrollView>;
}) {
  return (
    <ScrollView
      ref={scrollRef}
      style={kit.scroll}
      // THE FOOT IS `kit.page`'s OWN 48 px. This route is a focused flow
      // outside `(tabs)`, so no member tab bar renders over it. It used to
      // carry a 140 px reserve for the floating bar (goal-setup-current,
      // observation 4); with the bar gone that reserve was dead space, and on
      // a 390 × 844 phone it alone made the created receipt scroll
      // (measured `5800472286`; removed per Director `5800455297` §2).
      contentContainerStyle={kit.page}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={kit.column}
        testID={testID}
        {...(dataSet ? ({ dataSet } as Record<string, unknown>) : {})}
      >
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-new-goal-wordmark" />
          {groupId ? (
            <ButtonLink
              href={`/community/${groupId}`}
              style={chromeBackStyle}
              textStyle={kit.chromeLinkText}
              testID="wsf-new-goal-back"
              label="Back to community"
            />
          ) : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

// Flattened at module scope: ButtonLink hands its style to Link asChild,
// which needs one flat object. The link may shrink beside the wordmark so
// its text wraps inside the chrome row instead of pushing past the column.
const chromeBackStyle = StyleSheet.flatten([kit.chromeLink, { flexShrink: 1, minWidth: 0 }]);

const styles = StyleSheet.create({
  /*
    THE ACTION GREEN, on this route's primary calls to action.

    `kit.primaryButton` fills with PROGRESS_GREEN (#91CB7D), which Board 00
    reserves for CONFIRMED PROGRESS — the colour the Living WE speaks in. The
    kit says as much where it introduces the two tokens: the action green is
    "deliberately a SEPARATE token" because "a button must never be able to
    restate what the Living WE is saying about the shared total". A Champion's
    eye is trained on this screen, and a button wearing the progress colour
    trains it wrong even on a page that has no ratio to draw.

    So the three primaries here — Start this goal, Check community goals,
    Open the contribute page — are ACTION_GREEN on ON_ACTION ink, which is
    what the accepted target drew. Everything else about them is unchanged:
    same words, same behaviour, same hit target, same disabled treatment.
    `Start another goal` stays a secondary, because demoting it is the point.

    This is a route-local style rather than an edit to `kit.primaryButton`:
    the kit belongs to another surface, and one screen's ruling is not
    licence to restyle every button in the product.
  */
  primaryAction: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: { color: ON_ACTION, fontSize: 17, fontWeight: '800', textAlign: 'center' },

  // Eyebrow, heading and intro sit close together as one block.
  headingAfterEyebrow: { marginTop: 6 },
  intro: { marginTop: 8 },

  // ---- the spine: a numbered marker and a rule down to the next section ----
  step: { flexDirection: 'row', gap: 12 },
  spine: { width: 26, alignItems: 'center' },
  spineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spineDotText: { color: CREAM, fontSize: 13, fontWeight: '900' },
  spineRule: { flex: 1, width: 2, backgroundColor: HAIRLINE, marginTop: 6 },
  stepBody: { flex: 1, gap: 6, minWidth: 0 },
  stepTitle: { color: NAVY, fontSize: 18, fontWeight: '800', lineHeight: 26 },
  stepMeta: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  // The section's own surface. Depth instead of a border: kit.elevation
  // exists for exactly this, and four bordered rectangles down one page is
  // what made the form read as a wall.
  stepCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 13,
    gap: 9,
    marginTop: 2,
    ...elevation.card,
  },

  // The target and the unit read as one sentence, so they share a line where
  // the words allow it and stack when they do not.
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pairTarget: { flexGrow: 1, flexBasis: 120, minWidth: 110, gap: 2 },
  pairUnit: { flexGrow: 2, flexBasis: 150, minWidth: 140, gap: 2 },
  movements: { gap: 6 },
  unitChosen: {
    color: NAVY,
    fontSize: 16,
    fontWeight: '700',
    minHeight: 48,
    textAlignVertical: 'center',
    paddingVertical: 12,
  },

  // The goal as one phrase — the payoff of the first section, not a caption.
  payoff: {
    backgroundColor: OPTION_SELECTED_TINT,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  payoffText: { color: NAVY },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%' },
  pillDisabled: { opacity: 0.6 },

  // The start and end in words, one under the other.
  window: { gap: 4, marginTop: 4 },
  // The quiet time-zone line; it wraps when the column is narrow.
  zoneText: { flexShrink: 1, minWidth: 0 },

  // ---- the review and the commit, as one object ----
  commit: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: 16,
    gap: 5,
    ...elevation.hero,
  },
  commitTitle: { color: CREAM, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  commitMeta: { color: HERO_MUTED, fontSize: 14, lineHeight: 19 },
  commitRows: { marginTop: 4, marginBottom: 9 },
  commitNote: { color: HERO_MUTED, fontSize: 12.5, lineHeight: 17, marginTop: 8 },
  commitSecondary: {
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.45)',
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commitSecondaryText: { color: CREAM, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  sumRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: ON_NAVY_RULE,
  },
  sumLabel: { color: HERO_MUTED, fontSize: 14, flexShrink: 1, minWidth: 0 },
  sumValue: {
    color: CREAM,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 'auto',
  },

  // ---- what happened, when it was not a goal ----
  banner: { borderRadius: 16, padding: 14, gap: 4, borderLeftWidth: 5 },
  bannerRefused: { backgroundColor: '#FBECEC', borderLeftColor: ERROR_RED },
  bannerUnknown: { backgroundColor: '#FDF3E2', borderLeftColor: '#B8761B' },
  bannerTitleRefused: { color: ERROR_RED, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  bannerTitleUnknown: { color: '#8A5610', fontSize: 17, fontWeight: '800', lineHeight: 23 },
  bannerBody: { color: NAVY, fontSize: 14, lineHeight: 20 },

  // ---- the goal, once it exists ----
  livePanel: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: 18,
    gap: 8,
    ...elevation.hero,
  },
  liveEyebrow: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  liveTitle: { color: CREAM, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  livePhrase: { color: CREAM },
  liveRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 2 },
  liveMeta: { color: HERO_MUTED, fontSize: 13.5, lineHeight: 19 },
  liveCaption: { color: HERO_MUTED, fontSize: 12.5, lineHeight: 17 },
});
