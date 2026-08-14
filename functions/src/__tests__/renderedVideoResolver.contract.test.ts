import * as fs from 'fs';
import * as path from 'path';
import {
  buildReadyRenderedVideoMeta,
  flattenWorkout,
  hashRenderSource,
} from '../renderContract';
import {
  parseResolveRenderedVideoInput,
  RENDERED_VIDEO_SIGNED_URL_TTL_MS,
  RenderedVideoResolverDependencies,
  resolveRenderedVideoForCaller,
  validatedReadyMetadata,
} from '../renderedVideoResolver';

const BUCKET = 'goarrive.firebasestorage.app';
const WORKOUT_ID = 'workout-123';
const NOW = 1_800_000_000_000;
const WORKOUT_SOURCE = {
  coachId: 'coach-1',
  blocks: [
    {
      id: 'block-1',
      type: 'Circuit',
      movements: [{ id: 'movement-1', name: 'Squat', duration: 30 }],
    },
  ],
};
const SOURCE_HASH = hashRenderSource(WORKOUT_SOURCE);
const READY_META = buildReadyRenderedVideoMeta(
  BUCKET,
  WORKOUT_ID,
  { version: 4, sourceHash: SOURCE_HASH },
  flattenWorkout(WORKOUT_SOURCE, WORKOUT_ID),
);

type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface FakeResolver {
  dependencies: RenderedVideoResolverDependencies;
  calls: {
    workouts: string[];
    assignments: string[];
    sessions: string[];
    playbooks: string[];
    signed: Array<{ storageObject: string; expiresAt: number }>;
  };
}

function fakeResolver(options: {
  workout?: JsonRecord | null;
  assignments?: Record<string, JsonRecord>;
  sessions?: Record<string, JsonRecord>;
  playbooks?: Record<string, JsonRecord>;
  signedUrl?: string;
} = {}): FakeResolver {
  const workout = options.workout === undefined
    ? { ...clone(WORKOUT_SOURCE), renderedVideo: clone(READY_META) }
    : options.workout;
  const calls = {
    workouts: [] as string[],
    assignments: [] as string[],
    sessions: [] as string[],
    playbooks: [] as string[],
    signed: [] as Array<{ storageObject: string; expiresAt: number }>,
  };
  return {
    calls,
    dependencies: {
      bucketName: BUCKET,
      loadWorkout: async (id) => {
        calls.workouts.push(id);
        return workout ? clone(workout) : null;
      },
      loadAssignment: async (id) => {
        calls.assignments.push(id);
        return options.assignments?.[id] ? clone(options.assignments[id]) : null;
      },
      loadSessionInstance: async (id) => {
        calls.sessions.push(id);
        return options.sessions?.[id] ? clone(options.sessions[id]) : null;
      },
      loadPlaybook: async (id) => {
        calls.playbooks.push(id);
        return options.playbooks?.[id] ? clone(options.playbooks[id]) : null;
      },
      signReadUrl: async (storageObject, expiresAt) => {
        calls.signed.push({ storageObject, expiresAt });
        return options.signedUrl || 'https://storage.example.test/signed-render';
      },
      now: () => NOW,
    },
  };
}

function request(
  uid: string,
  token: JsonRecord,
  data: JsonRecord = { workoutId: WORKOUT_ID },
) {
  return { auth: { uid, token }, data };
}

describe('rendered-video read-time authorization', () => {
  test('authentication is required before any repository read or signing', async () => {
    const fake = fakeResolver();
    await expect(resolveRenderedVideoForCaller(
      { data: { workoutId: WORKOUT_ID } },
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fake.calls.workouts).toEqual([]);
    expect(fake.calls.signed).toEqual([]);
  });

  test.each([
    ['owner uid', 'coach-1', {}],
    ['owner coach claim', 'auth-user', { role: 'coach', coachId: 'coach-1' }],
    ['platform admin', 'admin-1', { role: 'platformAdmin' }],
  ])('%s can resolve the owning workout', async (_label, uid, token) => {
    const fake = fakeResolver();
    const result = await resolveRenderedVideoForCaller(
      request(uid, token as JsonRecord),
      fake.dependencies,
    );
    expect(result).toEqual(expect.objectContaining({
      ...READY_META,
      url: 'https://storage.example.test/signed-render',
      expiresAt: NOW + RENDERED_VIDEO_SIGNED_URL_TTL_MS,
    }));
    expect(fake.calls.signed).toEqual([{
      storageObject: `rendered-videos/${WORKOUT_ID}/v4/${SOURCE_HASH}.mp4`,
      expiresAt: NOW + RENDERED_VIDEO_SIGNED_URL_TTL_MS,
    }]);
  });

  test('an authenticated coach can resolve a shared workout just as Firestore rules allow', async () => {
    const fake = fakeResolver({
      workout: { ...clone(WORKOUT_SOURCE), isShared: true, renderedVideo: clone(READY_META) },
    });
    await expect(resolveRenderedVideoForCaller(
      request('coach-2', { role: 'coach', coachId: 'coach-2' }),
      fake.dependencies,
    )).resolves.toMatchObject({ sourceHash: SOURCE_HASH });
    expect(fake.calls.signed).toHaveLength(1);
  });

  test('a member needs an exact assignment owned by that member and coach', async () => {
    const fake = fakeResolver({
      assignments: {
        'assignment-1': {
          memberId: 'member-1',
          coachId: 'coach-1',
          workoutId: WORKOUT_ID,
        },
      },
    });
    await expect(resolveRenderedVideoForCaller(
      request('member-1', { role: 'member', coachId: 'coach-1' }, {
        workoutId: WORKOUT_ID,
        assignmentId: 'assignment-1',
      }),
      fake.dependencies,
    )).resolves.toMatchObject({ version: 4 });
    expect(fake.calls.assignments).toEqual(['assignment-1']);
    expect(fake.calls.signed).toHaveLength(1);
  });

  test.each([
    ['wrong member', { memberId: 'member-2', coachId: 'coach-1', workoutId: WORKOUT_ID }],
    ['wrong workout', { memberId: 'member-1', coachId: 'coach-1', workoutId: 'another-workout' }],
    ['wrong coach', { memberId: 'member-1', coachId: 'coach-2', workoutId: WORKOUT_ID }],
  ])('assignment proof rejects %s', async (_label, assignment) => {
    const fake = fakeResolver({ assignments: { 'assignment-1': assignment } });
    await expect(resolveRenderedVideoForCaller(
      request('member-1', { role: 'member', coachId: 'coach-1' }, {
        workoutId: WORKOUT_ID,
        assignmentId: 'assignment-1',
      }),
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.calls.signed).toEqual([]);
  });

  test('member proof fails closed when the workout has no owning coach', async () => {
    const workout = { ...clone(WORKOUT_SOURCE), renderedVideo: clone(READY_META) };
    delete workout.coachId;
    const fake = fakeResolver({
      workout,
      assignments: {
        'assignment-1': {
          memberId: 'member-1',
          coachId: 'coach-1',
          workoutId: WORKOUT_ID,
        },
      },
    });
    await expect(resolveRenderedVideoForCaller(
      request('member-1', { role: 'member', coachId: 'coach-1' }, {
        workoutId: WORKOUT_ID,
        assignmentId: 'assignment-1',
      }),
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.calls.signed).toEqual([]);
  });

  test('a member can resolve the exact pinned workout for their live session', async () => {
    const fake = fakeResolver({
      sessions: {
        'session-1': {
          memberId: 'member-1',
          coachId: 'coach-1',
          pinnedWorkoutId: WORKOUT_ID,
        },
      },
    });
    await expect(resolveRenderedVideoForCaller(
      request('member-1', { role: 'member', coachId: 'coach-1' }, {
        workoutId: WORKOUT_ID,
        sessionInstanceId: 'session-1',
      }),
      fake.dependencies,
    )).resolves.toMatchObject({ version: 4 });
    expect(fake.calls.sessions).toEqual(['session-1']);
    expect(fake.calls.playbooks).toEqual([]);
  });

  test('a playbook session resolves only its current sequence workout', async () => {
    const fake = fakeResolver({
      sessions: {
        'session-1': { memberId: 'member-1', coachId: 'coach-1', playbookId: 'playbook-1' },
      },
      playbooks: {
        'playbook-1': {
          coachId: 'coach-1',
          workoutIds: ['older-workout', WORKOUT_ID],
          nextWorkoutIndex: 1,
        },
      },
    });
    await expect(resolveRenderedVideoForCaller(
      request('member-1', { role: 'member', coachId: 'coach-1' }, {
        workoutId: WORKOUT_ID,
        sessionInstanceId: 'session-1',
      }),
      fake.dependencies,
    )).resolves.toMatchObject({ version: 4 });
    expect(fake.calls.playbooks).toEqual(['playbook-1']);
  });

  test('unrelated authenticated users cannot cause a signature', async () => {
    const fake = fakeResolver();
    await expect(resolveRenderedVideoForCaller(
      request('member-2', { role: 'member', coachId: 'coach-2' }),
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.calls.signed).toEqual([]);
  });
});

describe('rendered-video storage and expiry boundary', () => {
  test('the path must exactly match bucket, workout, version, and source hash', () => {
    const workout = { ...clone(WORKOUT_SOURCE), renderedVideo: clone(READY_META) };
    expect(validatedReadyMetadata(BUCKET, WORKOUT_ID, workout)).toMatchObject({
      storageObject: `rendered-videos/${WORKOUT_ID}/v4/${SOURCE_HASH}.mp4`,
    });

    const corrupted = clone(workout);
    (corrupted.renderedVideo as JsonRecord).storagePath =
      `gs://${BUCKET}/rendered-videos/another-workout/v4/${SOURCE_HASH}.mp4`;
    expect(() => validatedReadyMetadata(BUCKET, WORKOUT_ID, corrupted)).toThrow(
      expect.objectContaining({ code: 'data-loss' }),
    );
  });

  test('only the whitelisted timeline projection is returned', () => {
    const metadata = clone(READY_META) as typeof READY_META & { internalNote?: string };
    metadata.internalNote = 'must not cross the callable boundary';
    (metadata.blocks[0] as typeof metadata.blocks[0] & { internalNote?: string }).internalNote =
      'must not cross the callable boundary';
    const { metadata: projected } = validatedReadyMetadata(
      BUCKET,
      WORKOUT_ID,
      { ...clone(WORKOUT_SOURCE), renderedVideo: metadata },
    );
    expect(projected).not.toHaveProperty('internalNote');
    expect(projected.blocks[0]).not.toHaveProperty('internalNote');
  });

  test('not-ready metadata is never signed', async () => {
    const fake = fakeResolver({
      workout: { ...clone(WORKOUT_SOURCE), renderedVideo: { status: 'rendering' } },
    });
    await expect(resolveRenderedVideoForCaller(
      request('coach-1', {}),
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fake.calls.signed).toEqual([]);
  });

  test('proof inputs are mutually exclusive and document paths cannot be injected', () => {
    expect(() => parseResolveRenderedVideoInput({
      workoutId: WORKOUT_ID,
      assignmentId: 'assignment-1',
      sessionInstanceId: 'session-1',
    })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(() => parseResolveRenderedVideoInput({ workoutId: 'other/workout' })).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
  });

  test('invalid signer output is rejected', async () => {
    const fake = fakeResolver({ signedUrl: 'http://storage.example.test/not-secure' });
    await expect(resolveRenderedVideoForCaller(
      request('coach-1', {}),
      fake.dependencies,
    )).rejects.toMatchObject({ code: 'internal' });
  });

  test('the resolver production module has no persistence operation', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'renderedVideoResolver.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\.(set|create|update|delete)\s*\(/);
    expect(source).toContain("action: 'read'");
    expect(source).toContain("version: 'v4'");
  });
});
