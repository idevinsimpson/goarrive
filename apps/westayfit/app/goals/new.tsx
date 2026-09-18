import { Link, router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions, wsfIsStaging, wsfUsingEmulators } from '../../src/firebase';
import { type RepeatPolicy } from '../../src/contributionFlow';
import { wsfTheme } from '../../src/theme';

// The minimum surface needed to make the E4-A1 slice self-testable end to
// end on the local emulator: seed a synthetic community/goal, then deep-link
// into /contribute/{goalId} on one browser and /display/{goalId} on another.
//
// This screen is HARD-GATED to the emulator + loopback host via
// `wsfUsingEmulators` (double-gated inside firebase.ts). A production build
// cannot reach the form even if someone navigates the URL directly; every
// user-visible surface reads *LOCAL SYNTHETIC TEST* so a screenshot from any
// step is unmistakable in a review.
//
// Reuses `wsfCreateCommunity` (E3.5) for the fixture setup rather than
// inventing a synthetic seed collection — same primitive real signups run
// through — and then `wsfCreateGoal` (E4-A1) for the goal itself.

type CreatedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  communityGroupId: string;
};

function isoLocalDefault(offsetMs: number): string {
  // Emits a `datetime-local`-compatible string in the user's local time so
  // the two <input type="text"> fields on this page can be typed by a human
  // driving Playwright. The value is parsed back with `new Date(x)` and
  // passed to wsfCreateGoal as an ISO 8601 string, and the server converts
  // to Timestamp — so anything Date can parse is safe here.
  const t = new Date(Date.now() + offsetMs);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` +
    `T${pad(t.getHours())}:${pad(t.getMinutes())}`
  );
}

// Names the environment this screen is actually writing into, so a
// screenshot cannot be mistaken for the other one — or for production.
const SYNTHETIC_LABEL = wsfIsStaging ? 'STAGING SYNTHETIC TEST' : 'LOCAL SYNTHETIC TEST';

export default function NewGoalPage() {
  const { ready, user } = useWsfAuth();
  // The real path: a champion arrives from their community page, which passes
  // the group it already knows. Package C's job was to make that path work;
  // seeding a synthetic community from inside the product screen was a test
  // scaffold and has moved to isolated test setup
  // (apps/westayfit/tests-e2e/helpers/seed.ts).
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupIdParam = typeof params.groupId === 'string' ? params.groupId : '';

  const defaultStart = useMemo(() => isoLocalDefault(-60_000), []);
  const defaultEnd = useMemo(() => isoLocalDefault(60 * 60_000), []);

  const [communityGroupId, setCommunityGroupId] = useState(groupIdParam);

  const [title, setTitle] = useState('E4-A1 synthetic goal');
  const [target, setTarget] = useState('5000');
  const [unit, setUnit] = useState('squats');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [timezone, setTimezone] = useState('America/New_York');
  // The Champion's decision about how often one member may contribute. 'once'
  // is the default here for the same reason it is the default on the server:
  // it is the conservative answer, and a goal that takes repeat contributions
  // should be a choice somebody made.
  const [repeatPolicy, setRepeatPolicy] = useState<RepeatPolicy>('once');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedGoal | null>(null);


  const onSubmit = useCallback(async () => {
    if (submitting) return;
    setError(null);

    const trimmedGroupId = communityGroupId.trim();
    if (!trimmedGroupId) {
      setError('communityGroupId is required. Seed a synthetic community first.');
      return;
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 2 || trimmedTitle.length > 120) {
      setError('Title must be 2 to 120 characters.');
      return;
    }
    if (!/^[0-9]+$/.test(target.trim())) {
      setError('Target must be a whole number.');
      return;
    }
    const targetNum = Number.parseInt(target.trim(), 10);
    if (!Number.isInteger(targetNum) || targetNum < 1 || targetNum > 100_000_000) {
      setError('Target must be a positive integer up to 100000000.');
      return;
    }
    const trimmedUnit = unit.trim();
    if (trimmedUnit.length < 1 || trimmedUnit.length > 40) {
      setError('Unit must be 1 to 40 characters.');
      return;
    }

    const startsDate = new Date(startsAt);
    const endsDate = new Date(endsAt);
    if (Number.isNaN(startsDate.getTime())) {
      setError('startsAt is not a valid date/time.');
      return;
    }
    if (Number.isNaN(endsDate.getTime())) {
      setError('endsAt is not a valid date/time.');
      return;
    }
    if (endsDate.getTime() <= startsDate.getTime()) {
      setError('endsAt must be strictly after startsAt.');
      return;
    }
    const trimmedTz = timezone.trim();
    if (!trimmedTz) {
      setError('timezone is required.');
      return;
    }

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
        startsAt: startsDate.toISOString(),
        endsAt: endsDate.toISOString(),
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
      const message =
        e instanceof FirebaseError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : 'Could not create goal.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    communityGroupId,
    title,
    target,
    unit,
    startsAt,
    endsAt,
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
      <View style={styles.screen}>
        <View style={[styles.card, styles.testBanner]}>
          <Text style={styles.testBannerText} testID="wsf-new-goal-gated-off">
            SYNTHETIC TEST ONLY — DISABLED
          </Text>
          <Text style={styles.body}>
            /goals/new is only available in a synthetic test environment: the
            local Firestore emulator on a loopback host, or a staging build
            pointed at a separate staging backend.
          </Text>
          <Text style={styles.caption}>
            This screen writes SYNTHETIC data only. It is disabled in a
            production build by design.
          </Text>
        </View>
      </View>
    );
  }

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="New goal" testID="wsf-new-goal-disabled" />;
  }
  if (!ready) {
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>Loading…</Text>
      </View>
    );
  }
  if (!user) {
    return (
      <View style={styles.screen}>
        <TestBanner />
        <Text style={styles.heading}>Sign in to start a goal</Text>
        <Link href="/signin" style={styles.link}>
          Sign in
        </Link>
      </View>
    );
  }

  if (created) {
    return (
      <View style={styles.screen} testID="wsf-new-goal-created">
        <TestBanner />
        <Text style={styles.heading}>{SYNTHETIC_LABEL} — goal is live</Text>
        <View style={styles.card}>
          <Text style={styles.subheading}>{created.title}</Text>
          <Text style={styles.body}>
            {created.target} {created.unit}
          </Text>
          <Text style={styles.caption} selectable testID="wsf-new-goal-id">
            goalId: {created.goalId}
          </Text>
          <Text style={styles.caption} selectable testID="wsf-new-goal-group-id">
            communityGroupId: {created.communityGroupId}
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.subheading}>Share these links</Text>
          <Link
            href={{ pathname: '/contribute/[goalId]', params: { goalId: created.goalId } }}
            style={styles.link}
            testID="wsf-new-goal-contribute-link"
          >
            Contribute (phone)
          </Link>
          <Link
            href={{ pathname: '/display/[goalId]', params: { goalId: created.goalId } }}
            style={styles.link}
            testID="wsf-new-goal-display-link"
          >
            Big-screen display
          </Link>
        </View>
        <Pressable
          style={styles.primary}
          onPress={() =>
            router.push({
              pathname: '/contribute/[goalId]',
              params: { goalId: created.goalId },
            })
          }
          testID="wsf-new-goal-goto-contribute"
        >
          <Text style={styles.primaryText}>Open contribute page</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="wsf-new-goal-form">
      <TestBanner />
      <Text style={styles.heading}>Start a new goal</Text>

      <View style={styles.card}>
        <Text style={styles.subheading}>Step 1 — community</Text>
        <Text style={styles.caption}>
          Every goal is bound to a community. Arriving from a community page
          fills this in; the field stays editable for local testing.
        </Text>
        <Text style={styles.label}>communityGroupId</Text>
        <TextInput
          style={styles.input}
          value={communityGroupId}
          onChangeText={setCommunityGroupId}
          placeholder="Filled in when you arrive from your community"
          editable={!submitting}
          testID="wsf-new-goal-group-id-input"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.subheading}>Step 2 — goal</Text>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Community squat challenge"
          editable={!submitting}
          testID="wsf-new-goal-title"
        />
        <Text style={styles.label}>Target</Text>
        <TextInput
          style={styles.input}
          value={target}
          onChangeText={setTarget}
          placeholder="e.g. 5000"
          keyboardType="number-pad"
          inputMode="numeric"
          editable={!submitting}
          testID="wsf-new-goal-target"
        />
        <Text style={styles.label}>Unit</Text>
        <TextInput
          style={styles.input}
          value={unit}
          onChangeText={setUnit}
          placeholder="e.g. squats"
          editable={!submitting}
          testID="wsf-new-goal-unit"
        />
        <Text style={styles.label}>startsAt (local ISO, e.g. 2026-09-12T12:00)</Text>
        <TextInput
          style={styles.input}
          value={startsAt}
          onChangeText={setStartsAt}
          editable={!submitting}
          testID="wsf-new-goal-starts-at"
        />
        <Text style={styles.label}>endsAt (local ISO)</Text>
        <TextInput
          style={styles.input}
          value={endsAt}
          onChangeText={setEndsAt}
          editable={!submitting}
          testID="wsf-new-goal-ends-at"
        />
        <Text style={styles.label}>timezone (IANA, e.g. America/New_York)</Text>
        <TextInput
          style={styles.input}
          value={timezone}
          onChangeText={setTimezone}
          editable={!submitting}
          testID="wsf-new-goal-timezone"
        />
        <Text style={styles.label}>How often can one member contribute?</Text>
        <View style={styles.choiceRow}>
          <Pressable
            style={[styles.choice, repeatPolicy === 'once' && styles.choiceSelected]}
            onPress={() => setRepeatPolicy('once')}
            disabled={submitting}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeatPolicy === 'once' }}
            testID="wsf-new-goal-repeat-once"
          >
            <Text
              style={[
                styles.choiceText,
                repeatPolicy === 'once' && styles.choiceTextSelected,
              ]}
            >
              Once
            </Text>
          </Pressable>
          <Pressable
            style={[styles.choice, repeatPolicy === 'multiple' && styles.choiceSelected]}
            onPress={() => setRepeatPolicy('multiple')}
            disabled={submitting}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeatPolicy === 'multiple' }}
            testID="wsf-new-goal-repeat-multiple"
          >
            <Text
              style={[
                styles.choiceText,
                repeatPolicy === 'multiple' && styles.choiceTextSelected,
              ]}
            >
              More than once
            </Text>
          </Pressable>
        </View>
        <Text style={styles.caption} testID="wsf-new-goal-repeat-caption">
          {repeatPolicy === 'multiple'
            ? 'Each member can record as many contributions as they like while the goal is open.'
            : 'Each member records one contribution toward this goal.'}
        </Text>
        {error ? (
          <Text style={styles.errorText} testID="wsf-new-goal-error">
            {error}
          </Text>
        ) : null}
        <Pressable
          style={[styles.primary, submitting && styles.primaryDisabled]}
          onPress={onSubmit}
          disabled={submitting}
          testID="wsf-new-goal-submit"
        >
          <Text style={styles.primaryText}>
            {submitting ? 'Creating…' : 'Create synthetic goal'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function TestBanner() {
  return (
    <View style={styles.testBanner} testID="wsf-new-goal-test-banner">
      <Text style={styles.testBannerText}>{SYNTHETIC_LABEL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: wsfTheme.spacing.lg,
    gap: wsfTheme.spacing.md,
    backgroundColor: wsfTheme.colors.background,
  },
  testBanner: {
    backgroundColor: '#B0342A',
    padding: wsfTheme.spacing.sm,
    borderRadius: wsfTheme.radius.sm,
    alignItems: 'center',
  },
  testBannerText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 1,
    fontSize: 14,
  },
  card: {
    backgroundColor: wsfTheme.colors.surface,
    padding: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    gap: wsfTheme.spacing.sm,
  },
  heading: {
    ...wsfTheme.typography.heading,
    color: wsfTheme.colors.text,
  },
  subheading: {
    ...wsfTheme.typography.subheading,
    color: wsfTheme.colors.text,
  },
  body: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.text,
  },
  caption: {
    ...wsfTheme.typography.caption,
    color: wsfTheme.colors.textMuted,
  },
  label: {
    ...wsfTheme.typography.caption,
    color: wsfTheme.colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.sm,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    fontSize: 16,
    color: wsfTheme.colors.text,
    backgroundColor: wsfTheme.colors.background,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: wsfTheme.spacing.sm,
  },
  choice: {
    flex: 1,
    // 44 px minimum touch target, as every other control on these screens.
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.sm,
    backgroundColor: wsfTheme.colors.background,
  },
  choiceSelected: {
    borderColor: wsfTheme.colors.primary,
    backgroundColor: wsfTheme.colors.primary,
  },
  choiceText: {
    fontSize: 16,
    fontWeight: '600',
    color: wsfTheme.colors.text,
  },
  choiceTextSelected: {
    color: wsfTheme.colors.surface,
  },
  primary: {
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: wsfTheme.colors.background,
    borderWidth: 1,
    borderColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.sm,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: wsfTheme.colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    color: wsfTheme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    ...wsfTheme.typography.caption,
    color: '#B0342A',
  },
  link: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.primary,
    textDecorationLine: 'underline',
  },
});
