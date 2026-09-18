import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { SecondaryLink, TextField } from '../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions, wsfIsStaging, wsfUsingEmulators } from '../../src/firebase';
import { type RepeatPolicy } from '../../src/contributionFlow';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

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
      <Page>
        <View style={kit.card}>
          <Text style={[kit.badge, styles.badge]} testID="wsf-new-goal-gated-off">
            SYNTHETIC TEST ONLY — DISABLED
          </Text>
          <Text style={kit.body}>
            /goals/new is only available in a synthetic test environment: the
            local Firestore emulator on a loopback host, or a staging build
            pointed at a separate staging backend.
          </Text>
          <Text style={kit.caption}>
            This screen writes SYNTHETIC data only. It is disabled in a
            production build by design.
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
        <Text style={kit.body}>Loading…</Text>
      </Page>
    );
  }
  if (!user) {
    return (
      <Page>
        <TestBanner />
        <Text style={kit.heading}>Sign in to start a goal</Text>
        <SecondaryLink href="/signin" label="Sign in" />
      </Page>
    );
  }

  if (created) {
    // String hrefs, as Community Home builds them: the anchor resolves to the
    // same `/contribute/<goalId>` the object form produced.
    const contributeHref = `/contribute/${created.goalId}`;
    const displayHref = `/display/${created.goalId}`;
    return (
      <Page testID="wsf-new-goal-created">
        <TestBanner />
        <Text style={kit.headingCompact}>{SYNTHETIC_LABEL} — goal is live</Text>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>{created.title}</Text>
          <Text style={kit.body}>
            {created.target} {created.unit}
          </Text>
          <Text style={kit.caption} selectable testID="wsf-new-goal-id">
            goalId: {created.goalId}
          </Text>
          <Text style={kit.caption} selectable testID="wsf-new-goal-group-id">
            communityGroupId: {created.communityGroupId}
          </Text>
        </View>
        <View style={kit.card}>
          <Text style={kit.cardTitle}>Share these links</Text>
          <ButtonLink
            href={contributeHref}
            style={kit.tertiaryButton}
            textStyle={kit.tertiaryButtonText}
            testID="wsf-new-goal-contribute-link"
            label="Contribute (phone)"
          />
          <ButtonLink
            href={displayHref}
            style={kit.tertiaryButton}
            textStyle={kit.tertiaryButtonText}
            testID="wsf-new-goal-display-link"
            label="Big-screen display"
          />
        </View>
        <Pressable
          style={kit.primaryButton}
          onPress={() =>
            router.push({
              pathname: '/contribute/[goalId]',
              params: { goalId: created.goalId },
            })
          }
          testID="wsf-new-goal-goto-contribute"
        >
          <Text style={kit.primaryButtonText}>Open contribute page</Text>
        </Pressable>
      </Page>
    );
  }

  return (
    <Page testID="wsf-new-goal-form">
      <TestBanner />
      <Text style={kit.heading}>Start a new goal</Text>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>Step 1 — community</Text>
        <Text style={kit.caption}>
          Every goal is bound to a community. Arriving from a community page
          fills this in; the field stays editable for local testing.
        </Text>
        <Text style={[kit.fieldLabel, styles.label]}>communityGroupId</Text>
        <TextField
          value={communityGroupId}
          onChangeText={setCommunityGroupId}
          placeholder="Filled in when you arrive from your community"
          editable={!submitting}
          testID="wsf-new-goal-group-id-input"
        />
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>Step 2 — goal</Text>
        <Text style={[kit.fieldLabel, styles.label]}>Title</Text>
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Community squat challenge"
          editable={!submitting}
          testID="wsf-new-goal-title"
        />
        <Text style={[kit.fieldLabel, styles.label]}>Target</Text>
        <TextField
          value={target}
          onChangeText={setTarget}
          placeholder="e.g. 5000"
          keyboardType="number-pad"
          inputMode="numeric"
          editable={!submitting}
          testID="wsf-new-goal-target"
        />
        <Text style={[kit.fieldLabel, styles.label]}>Unit</Text>
        <TextField
          value={unit}
          onChangeText={setUnit}
          placeholder="e.g. squats"
          editable={!submitting}
          testID="wsf-new-goal-unit"
        />
        <Text style={[kit.fieldLabel, styles.label]}>startsAt (local ISO, e.g. 2026-09-12T12:00)</Text>
        <TextField
          value={startsAt}
          onChangeText={setStartsAt}
          editable={!submitting}
          testID="wsf-new-goal-starts-at"
        />
        <Text style={[kit.fieldLabel, styles.label]}>endsAt (local ISO)</Text>
        <TextField
          value={endsAt}
          onChangeText={setEndsAt}
          editable={!submitting}
          testID="wsf-new-goal-ends-at"
        />
        <Text style={[kit.fieldLabel, styles.label]}>timezone (IANA, e.g. America/New_York)</Text>
        <TextField
          value={timezone}
          onChangeText={setTimezone}
          editable={!submitting}
          testID="wsf-new-goal-timezone"
        />
        <Text style={[kit.fieldLabel, styles.label]}>How often can one member contribute?</Text>
        <View style={styles.choiceRow}>
          <Pressable
            style={[kit.pill, styles.choice, repeatPolicy === 'once' && kit.pillSelected]}
            onPress={() => setRepeatPolicy('once')}
            disabled={submitting}
            accessibilityRole="radio"
            accessibilityState={{ selected: repeatPolicy === 'once' }}
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
        {error ? (
          <Text style={kit.errorText} testID="wsf-new-goal-error">
            {error}
          </Text>
        ) : null}
        <Pressable
          style={[kit.primaryButton, styles.submit, submitting && kit.primaryButtonDisabled]}
          onPress={onSubmit}
          disabled={submitting}
          testID="wsf-new-goal-submit"
        >
          <Text style={kit.primaryButtonText}>
            {submitting ? 'Creating…' : 'Create synthetic goal'}
          </Text>
        </Pressable>
      </View>
    </Page>
  );
}

/**
 * The page every state of this screen sits on: the scrolling cream page,
 * the wordmark chrome, then the state's own content in the column. The
 * state's testID stays on the column, a visible element, so the specs that
 * wait for `wsf-new-goal-form` / `wsf-new-goal-created` see what they saw.
 */
function Page({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.column} testID={testID}>
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-new-goal-wordmark" />
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

function TestBanner() {
  return (
    <View testID="wsf-new-goal-test-banner">
      <Text style={[kit.badge, styles.badge]}>{SYNTHETIC_LABEL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The badge is a fixed label, never a stored string; it sits at its own
  // width on the left and wraps word by word when the column is narrower.
  badge: { alignSelf: 'flex-start' },
  // Fields are grouped label-over-input; the label's top margin opens the
  // gap between one group and the next inside the card.
  label: { marginTop: 6 },
  // The two policy pills share a wrapping row; each may shrink so its text
  // wraps inside the pill rather than pushing past the column.
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flexShrink: 1, minWidth: 0 },
  submit: { marginTop: 8 },
});
