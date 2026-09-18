import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { SecondaryLink, TextField } from '../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions, wsfIsStaging, wsfUsingEmulators } from '../../src/firebase';
import { type RepeatPolicy } from '../../src/contributionFlow';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { isValidTimeZone } from '../../src/ui/dates';
import { kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

// Where a community Champion starts a shared goal. The community page sends
// them here with the group it already knows (`?groupId=…`); they name the
// goal, set the target, pick how long it runs, choose how often one member
// may take part, and land on a "your goal is live" screen with the two links
// to share (the phone contribute page and the big-screen display).
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
};

type Duration = '1w' | '2w' | '1m' | 'custom';

const DURATIONS: ReadonlyArray<{ key: Duration; label: string }> = [
  { key: '1w', label: '1 week' },
  { key: '2w', label: '2 weeks' },
  { key: '1m', label: '1 month' },
  { key: 'custom', label: 'Custom' },
];

// Names the environment this screen is actually writing into. Machine-readable
// only (a data attribute on the form); it never renders as text.
const SYNTHETIC_LABEL = wsfIsStaging ? 'STAGING SYNTHETIC TEST' : 'LOCAL SYNTHETIC TEST';

const DATE_HINT = 'Write the day as year-month-day, then the time, like 2026-09-25 2:00 PM.';
const DATE_ERROR = 'Write the day as year-month-day, then the time, like 2026-09-25 2:00 PM.';
const FALLBACK_TIME_ZONE = 'America/New_York';

// Time zones a Champion can pick with one tap. Each is shown in words (via
// Intl), never as its identifier; the identifier is what the callable gets.
// Arizona keeps standard time all year, which Intl names "Mountain Standard
// Time" — beside "Mountain Time" that reads as a duplicate, so it is named
// for the place instead.
const ZONE_LABELS: Readonly<Record<string, string>> = { 'America/Phoenix': 'Arizona Time' };
const COMMON_TIME_ZONES: ReadonlyArray<string> = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
];

// ---- dates: typed as "2026-09-25 2:00 PM" (or 14:00), read in local time ----

const LOCAL_DATE_TIME =
  /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]\.?)?\s*$/;

/**
 * Reads a typed date and time in the device's local time. Accepts the day as
 * year-month-day followed by a clock time, 12-hour ("2:00 PM") or 24-hour
 * ("14:00"); anything else — including a calendar day that does not exist —
 * comes back null.
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

/** "2026-09-25 2:00 PM" — the shape the custom inputs show and accept. */
function formatLocalDateTime(d: Date): string {
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${hours12}:${pad(d.getMinutes())} ${hours24 < 12 ? 'AM' : 'PM'}`
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
 * in the device's own time, which is how the typed values are read.
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

/** The device's zone, when the platform can name it; otherwise the product default. */
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

type FieldErrors = Partial<{
  title: string;
  target: string;
  unit: string;
  starts: string;
  ends: string;
  timezone: string;
}>;

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

  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  // The start is "now" on the quarter hour, fixed when the page opens so the
  // line the Champion reads is the instant that is sent. Custom lets them
  // type both ends; a preset derives the end from the start.
  const [startsAt, setStartsAt] = useState(() => formatLocalDateTime(quarterHourFloor(new Date())));
  const [endsAt, setEndsAt] = useState('');
  const [duration, setDuration] = useState<Duration>('1w');
  const [deviceZone] = useState(deviceTimeZone);
  const [timezone, setTimezone] = useState(deviceZone);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  // The Champion's decision about how often one member may contribute. 'once'
  // is the default here for the same reason it is the default on the server:
  // it is the conservative answer, and a goal that takes repeat contributions
  // should be a choice somebody made.
  const [repeatPolicy, setRepeatPolicy] = useState<RepeatPolicy>('once');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedGoal | null>(null);

  const now = new Date();
  // The device's own zone leads the list when it is not already a common one.
  const zoneChoices = COMMON_TIME_ZONES.includes(deviceZone)
    ? COMMON_TIME_ZONES
    : [deviceZone, ...COMMON_TIME_ZONES];
  const startsDate = parseLocalDateTime(startsAt);
  const endsDate =
    duration === 'custom'
      ? parseLocalDateTime(endsAt)
      : startsDate
        ? addDuration(startsDate, duration)
        : null;

  const clearFieldError = useCallback((key: keyof FieldErrors) => {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  const chooseDuration = useCallback(
    (next: Duration) => {
      setDuration(next);
      clearFieldError('starts');
      clearFieldError('ends');
      if (next !== 'custom' && !parseLocalDateTime(startsAt)) {
        // A start typed under Custom that never parsed would otherwise ride
        // along invisibly under a preset and stop the submit with no message.
        // A preset starts now.
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
      errors.starts = DATE_ERROR;
    }
    const end =
      duration === 'custom' ? parseLocalDateTime(endsAt) : start ? addDuration(start, duration) : null;
    if (duration === 'custom' && !end) {
      errors.ends = DATE_ERROR;
    } else if (start && end && end.getTime() <= start.getTime()) {
      errors.ends = 'The end must be after the start.';
    }

    const trimmedTz = timezone.trim();
    if (!trimmedTz) {
      errors.timezone = 'Choose a time zone.';
    } else if (!isValidTimeZone(trimmedTz)) {
      errors.timezone =
        "We don't recognise that time zone. Pick one above, or type the region and city, like Europe/London.";
    }

    if (Object.keys(errors).length > 0 || !start || !end) {
      setFieldErrors(errors);
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
        testID="wsf-new-goal-created"
        // The ids the browser specs read, as data attributes on the container
        // (react-native-web renders dataSet as data-goal-id / data-group-id).
        // Nothing on the page prints them.
        dataSet={{ 'goal-id': created.goalId, 'group-id': created.communityGroupId }}
      >
        <View>
          <Text style={kit.heading}>Your goal is live</Text>
          <Text style={[kit.intro, styles.intro]}>
            Share it with your community and put it on a screen.
          </Text>
        </View>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>{created.title}</Text>
          <Text style={kit.body}>
            Goal: {created.target} {created.unit}
          </Text>
        </View>
        <Pressable
          style={kit.primaryButton}
          onPress={() =>
            router.push({
              pathname: '/contribute/[goalId]',
              params: { goalId: created.goalId },
            })
          }
          accessibilityRole="button"
          testID="wsf-new-goal-goto-contribute"
        >
          <Text style={kit.primaryButtonText}>Open the contribute page</Text>
        </Pressable>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>Share this goal</Text>
          <ButtonLink
            href={contributeHref}
            style={kit.tertiaryButton}
            textStyle={kit.tertiaryButtonText}
            testID="wsf-new-goal-contribute-link"
            label="Contribute on a phone"
          />
          <ButtonLink
            href={displayHref}
            style={kit.tertiaryButton}
            textStyle={kit.tertiaryButtonText}
            testID="wsf-new-goal-display-link"
            label="Show on a big screen"
          />
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
        <View>
          <Text style={kit.heading}>Start a goal</Text>
          <Text style={[kit.intro, styles.intro]}>
            Goals belong to a community, so they start from one.
          </Text>
        </View>
        <View style={kit.card} testID="wsf-new-goal-no-community">
          <Text style={kit.cardTitle}>Start this from your community</Text>
          <Text style={kit.body}>
            Open your community page and tap Start a goal. We'll know which
            community the goal is for.
          </Text>
        </View>
        <ButtonLink
          href="/"
          style={kit.secondaryButton}
          textStyle={kit.secondaryButtonText}
          testID="wsf-new-goal-home"
          label="Back to home"
        />
      </Page>
    );
  }

  return (
    <Page
      testID="wsf-new-goal-form"
      groupId={groupIdParam}
      // The community this goal is for, as data-group-id on the form (the
      // specs read it there); the Champion reads one plain line.
      dataSet={{ environment: SYNTHETIC_LABEL, 'group-id': groupIdParam }}
    >
      <View>
        <Text style={kit.heading}>Start a goal</Text>
        <Text style={[kit.intro, styles.intro]}>
          Set what your community will do together. Every contribution adds to
          one shared total.
        </Text>
      </View>

      <Text style={kit.body}>This goal belongs to your community.</Text>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>What we'll do</Text>
        <Text style={[kit.fieldLabel, styles.label]}>Goal name</Text>
        <TextField
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            clearFieldError('title');
          }}
          placeholder="e.g. 5,000 squats together"
          editable={!submitting}
          testID="wsf-new-goal-title"
        />
        <FieldError message={fieldErrors.title} testID="wsf-new-goal-title-error" />
        <Text style={[kit.fieldLabel, styles.label]}>Target</Text>
        <TextField
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
        <Text style={[kit.fieldLabel, styles.label]}>What you're counting</Text>
        <TextField
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

      <View style={kit.card}>
        <Text style={kit.cardTitle}>When</Text>
        {duration !== 'custom' && startsDate ? (
          <Text style={kit.body} testID="wsf-new-goal-starts-line">
            Starts {describeMoment(startsDate, now)}
          </Text>
        ) : null}
        <Text style={[kit.fieldLabel, styles.label]}>How long</Text>
        <View style={styles.choiceRow}>
          {DURATIONS.map((d) => (
            <Pressable
              key={d.key}
              style={[kit.pill, styles.choice, duration === d.key && kit.pillSelected]}
              onPress={() => chooseDuration(d.key)}
              disabled={submitting}
              accessibilityRole="radio"
              accessibilityState={{ selected: duration === d.key }}
              // accessibilityState carries it on native; the raw attribute is
              // for browsers, which only read the DOM.
              {...({ 'aria-selected': duration === d.key } as Record<string, unknown>)}
              testID={`wsf-new-goal-duration-${d.key}`}
            >
              <Text style={[kit.pillText, duration === d.key && kit.pillTextSelected]}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {duration === 'custom' ? (
          <>
            <Text style={[kit.fieldLabel, styles.label]}>Starts</Text>
            <TextField
              value={startsAt}
              onChangeText={(v) => {
                setStartsAt(v);
                clearFieldError('starts');
                clearFieldError('ends');
              }}
              editable={!submitting}
              testID="wsf-new-goal-starts-at"
            />
            <Text style={kit.caption}>{DATE_HINT}</Text>
            <FieldError message={fieldErrors.starts} testID="wsf-new-goal-starts-error" />
            <Text style={[kit.fieldLabel, styles.label]}>Ends</Text>
            <TextField
              value={endsAt}
              onChangeText={(v) => {
                setEndsAt(v);
                clearFieldError('ends');
              }}
              editable={!submitting}
              testID="wsf-new-goal-ends-at"
            />
            <Text style={kit.caption}>{DATE_HINT}</Text>
          </>
        ) : null}
        {endsDate ? (
          <Text style={kit.body} testID="wsf-new-goal-ends-line">
            Ends {describeMoment(endsDate, now)}
          </Text>
        ) : null}
        <FieldError message={fieldErrors.ends} testID="wsf-new-goal-ends-error" />
        <View style={styles.zoneRow}>
          <Text style={[kit.caption, styles.zoneText]} testID="wsf-new-goal-timezone-line">
            Times are in {zoneInWords(timezone.trim() || FALLBACK_TIME_ZONE)}
          </Text>
          {timezoneOpen ? null : (
            <Pressable
              style={kit.tertiaryButton}
              onPress={() => setTimezoneOpen(true)}
              disabled={submitting}
              accessibilityRole="button"
              testID="wsf-new-goal-timezone-change"
            >
              <Text style={kit.tertiaryButtonText}>Change</Text>
            </Pressable>
          )}
        </View>
        {timezoneOpen ? (
          <>
            <Text style={[kit.fieldLabel, styles.label]}>Time zone</Text>
            <View style={styles.choiceRow}>
              {zoneChoices.map((tz) => (
                <Pressable
                  key={tz}
                  style={[kit.pill, styles.choice, timezone.trim() === tz && kit.pillSelected]}
                  onPress={() => {
                    setTimezone(tz);
                    clearFieldError('timezone');
                  }}
                  disabled={submitting}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: timezone.trim() === tz }}
                  {...({ 'aria-selected': timezone.trim() === tz } as Record<string, unknown>)}
                  testID={`wsf-new-goal-timezone-option-${tz.replace(/[^A-Za-z0-9]+/g, '-')}`}
                >
                  <Text style={[kit.pillText, timezone.trim() === tz && kit.pillTextSelected]}>
                    {zoneInWords(tz)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[kit.fieldLabel, styles.label]}>Somewhere else?</Text>
            <TextField
              value={timezone}
              onChangeText={(v) => {
                setTimezone(v);
                clearFieldError('timezone');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              testID="wsf-new-goal-timezone"
            />
            <Text style={kit.caption}>Type the region and city, like Europe/London.</Text>
          </>
        ) : null}
        <FieldError message={fieldErrors.timezone} testID="wsf-new-goal-timezone-error" />
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>How members take part</Text>
        <Text style={[kit.fieldLabel, styles.label]}>How often can one member contribute?</Text>
        <View style={styles.choiceRow}>
          <Pressable
            style={[kit.pill, styles.choice, repeatPolicy === 'once' && kit.pillSelected]}
            onPress={() => setRepeatPolicy('once')}
            disabled={submitting}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeatPolicy === 'once' }}
            {...({ 'aria-selected': repeatPolicy === 'once' } as Record<string, unknown>)}
            testID="wsf-new-goal-repeat-once"
          >
            <Text
              style={[
                kit.pillText,
                repeatPolicy === 'once' && kit.pillTextSelected,
              ]}
            >
              Once
            </Text>
          </Pressable>
          <Pressable
            style={[kit.pill, styles.choice, repeatPolicy === 'multiple' && kit.pillSelected]}
            onPress={() => setRepeatPolicy('multiple')}
            disabled={submitting}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeatPolicy === 'multiple' }}
            {...({ 'aria-selected': repeatPolicy === 'multiple' } as Record<string, unknown>)}
            testID="wsf-new-goal-repeat-multiple"
          >
            <Text
              style={[
                kit.pillText,
                repeatPolicy === 'multiple' && kit.pillTextSelected,
              ]}
            >
              More than once
            </Text>
          </Pressable>
        </View>
        <Text style={kit.caption} testID="wsf-new-goal-repeat-caption">
          {repeatPolicy === 'multiple'
            ? 'Each member can record as many contributions as they like while the goal is open.'
            : 'Each member records one contribution toward this goal.'}
        </Text>
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
}: {
  children: ReactNode;
  testID?: string;
  groupId?: string;
  dataSet?: Record<string, string>;
}) {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
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
  // Heading and intro sit close together as one block.
  intro: { marginTop: 8 },
  // Fields are grouped label-over-input; the label's top margin opens the
  // gap between one group and the next inside the card.
  label: { marginTop: 6 },
  // Choice pills share a wrapping row; each may shrink so its text wraps
  // inside the pill rather than pushing past the column.
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flexShrink: 1, minWidth: 0 },
  // The quiet time-zone line with its "Change" control beside it; the line
  // wraps under the control when the column is narrow.
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  zoneText: { flexShrink: 1, minWidth: 0 },
});
