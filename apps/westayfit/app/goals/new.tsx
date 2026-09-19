import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createRef, useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { ButtonLink } from '../../src/ui/ButtonLink';
import { isValidTimeZone } from '../../src/ui/dates';
import { DateTimeField, type DateTimeFieldHandle } from '../../src/ui/DateTimeField';
import { kit, NAVY } from '../../src/ui/kit';
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
 * A plain sentence for whatever the callable refused with. The known codes
 * wsfCreateGoal raises are named; nothing here ever shows a raw code.
 */
function describeServerError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'functions/unauthenticated':
        return 'Please sign in again, then start the goal.';
      case 'functions/failed-precondition':
        return 'Verify your email address before starting a goal.';
      case 'functions/permission-denied':
        return 'Only a Champion of this community can start a goal here.';
      case 'functions/invalid-argument':
        return "Something about this goal didn't look right. Check the details and try again.";
      case 'functions/not-found':
        return "We couldn't find that community.";
      case 'functions/resource-exhausted':
        return 'Too many goals were started in a short time. Wait a moment and try again.';
      case 'functions/unavailable':
      case 'functions/deadline-exceeded':
        return "We couldn't reach the server. Check your connection and try again.";
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

// The fields a submit can refuse, in the order they sit on the page: the
// first one refused is the one the page focuses and scrolls to.
const FIELD_ORDER = ['title', 'target', 'unit', 'starts', 'ends', 'timezone'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];
type FieldErrors = Partial<Record<FieldKey, string>>;

export default function NewGoalPage() {
  const { ready, user } = useWsfAuth();
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
  const [error, setError] = useState<string | null>(null);
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
  const trimmedUnit = unit.trim();
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
    setError(null);

    const errors: FieldErrors = {};

    // The form only renders with a community; this is a guard, not a state.
    const trimmedGroupId = groupIdParam;
    if (!trimmedGroupId) {
      setError('Open this page from your community to start a goal.');
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

    const trimmedUnit = unit.trim();
    if (!trimmedUnit) {
      errors.unit = "Say what you're counting, like squats or miles.";
    } else if (trimmedUnit.length > 40) {
      errors.unit = 'Keep the unit to 40 characters or fewer.';
    }

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
      setError(describeServerError(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    groupIdParam,
    title,
    target,
    unit,
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
          <Text style={[kit.heading, styles.headingAfterEyebrow]}>Your goal is live</Text>
          <Text style={[kit.intro, styles.intro]}>
            Send it to your members and put it on a screen.
          </Text>
        </View>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>{created.title}</Text>
          <Text style={styles.definition}>{definitionPhrase(created.target, created.unit)}</Text>
          <Text style={kit.cardMeta}>
            Starts {describeMoment(created.startsAt, now)} · Ends {describeMoment(created.endsAt, now)}
          </Text>
          <Text style={kit.cardMeta}>
            {zoneInWords(created.timezone)} · {repeatLabel(created.repeatPolicy)}
          </Text>
        </View>
        {/*
          The one next useful action, and the only control on this screen that
          opens the contribute page. It used to be a button that navigated
          there in code, with a second, differently-labelled secondary
          ("Contribute on a phone") pointing at the same route — two controls,
          one job, and no way for a Champion to tell them apart. It is a
          ButtonLink now, so the primary itself carries the href.
        */}
        <ButtonLink
          href={contributeHref}
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-new-goal-goto-contribute"
          label="Open the contribute page"
        />
        <Text style={kit.caption}>
          Where members record what they did and watch the shared total grow.
        </Text>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>Put it to work</Text>
          <View style={styles.action}>
            <ButtonLink
              href={displayHref}
              style={kit.secondaryButton}
              textStyle={kit.secondaryButtonText}
              testID="wsf-new-goal-display-link"
              label="Show on a big screen"
            />
            <Text style={kit.cardMeta}>
              A live view of the total for a TV or projector where everyone can see it.
            </Text>
          </View>
        </View>
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
        <ButtonLink
          href="/"
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-new-goal-home"
          label="Go to your communities"
        />
      </Page>
    );
  }

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
        <Text style={[kit.heading, styles.headingAfterEyebrow]}>Start a goal</Text>
        <Text style={[kit.intro, styles.intro]}>
          Set what your community will do together. Every contribution adds to one shared total.
        </Text>
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>The goal</Text>
        <Text style={kit.cardMeta}>
          Name it, set the total, and say what you're counting — together they read like
          "5,000 squats" or "300 miles".
        </Text>
        <View ref={anchorRefs.title}>
          <Text style={[kit.fieldLabel, styles.label]}>Goal name</Text>
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
        <View ref={anchorRefs.target}>
          <Text style={[kit.fieldLabel, styles.label]}>Target</Text>
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
        <View ref={anchorRefs.unit}>
          <Text style={[kit.fieldLabel, styles.label]}>What you're counting</Text>
          <TextField
            ref={unitRef}
            value={unit}
            onChangeText={(v) => {
              setUnit(v);
              clearFieldError('unit');
            }}
            placeholder="e.g. squats"
            editable={!submitting}
            testID="wsf-new-goal-unit"
          />
          <FieldError message={fieldErrors.unit} testID="wsf-new-goal-unit-error" />
        </View>
        {definition ? (
          <Text style={[styles.definition, styles.label]} testID="wsf-new-goal-definition">
            {definition}
          </Text>
        ) : null}
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>When</Text>
        <Text style={[kit.fieldLabel, styles.label]}>How long</Text>
        <OptionGroup accessibilityLabel="How long" testID="wsf-new-goal-duration">
          {DURATIONS.map((d) => (
            <OptionRow
              key={d.key}
              label={d.label}
              description={d.description}
              selected={duration === d.key}
              onPress={() => chooseDuration(d.key)}
              disabled={submitting}
              testID={`wsf-new-goal-duration-${d.key}`}
            />
          ))}
        </OptionGroup>
        {duration === 'custom' ? (
          <>
            <View ref={anchorRefs.starts}>
              <Text style={[kit.fieldLabel, styles.label]}>Starts</Text>
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
              <Text style={[kit.fieldLabel, styles.label]}>Ends</Text>
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
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>How members take part</Text>
        <Text style={[kit.fieldLabel, styles.label]}>How often can one member contribute?</Text>
        <OptionGroup accessibilityLabel="How often can one member contribute?" testID="wsf-new-goal-repeat">
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
      </View>

      <View style={kit.cardQuiet} testID="wsf-new-goal-summary">
        <Text style={kit.cardTitle}>Check it over</Text>
        <Text style={kit.cardMeta}>This is what your community will see.</Text>
        <SummaryRow label="Community" value={communityLabel} />
        <SummaryRow label="Goal" value={title.trim() || 'Not named yet'} />
        <SummaryRow label="Target" value={definition ?? 'Not set yet'} />
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

      {error ? (
        <Text style={kit.errorText} testID="wsf-new-goal-error">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={[kit.primaryButton, submitting && kit.primaryButtonDisabled]}
        onPress={onSubmit}
        disabled={submitting}
        accessibilityRole="button"
        testID="wsf-new-goal-submit"
      >
        <Text style={kit.primaryButtonText}>
          {submitting ? 'Starting…' : 'Start this goal'}
        </Text>
      </Pressable>
    </Page>
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

/** One label/value line of the summary; the value wraps under the label when narrow. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={kit.row}>
      <Text style={kit.rowLabel}>{label}</Text>
      <Text style={kit.rowValue}>{value}</Text>
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
  // Eyebrow, heading and intro sit close together as one block.
  headingAfterEyebrow: { marginTop: 6 },
  intro: { marginTop: 8 },
  // Fields are grouped label-over-input; the label's top margin opens the
  // gap between one group and the next inside the card.
  label: { marginTop: 6 },
  // The goal as one phrase: "5,000 squats".
  definition: { color: NAVY, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  // The start and end in words, one under the other.
  window: { gap: 4, marginTop: 4 },
  // The quiet time-zone line with its "Change" control beside it; the line
  // wraps under the control when the column is narrow.
  zoneText: { flexShrink: 1, minWidth: 0 },
  // A secondary action with its one-line purpose under it.
  action: { gap: 6, marginTop: 4 },
});
