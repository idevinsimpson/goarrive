import * as fs from 'fs';
import * as path from 'path';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  buildReadyRenderedVideoMeta,
  buildRenderStorageLocation,
  decodeSegmentId,
  flattenWorkout,
  hashRenderSource,
  isCurrentRenderRequest,
  Segment,
} from '../renderContract';
import { parseRenderServiceTarget } from '../renderServiceTarget';
import {
  claimRenderRequest,
  commitFailedRenderIfCurrent,
  commitReadyRenderIfCurrent,
} from '../renderState';
import {
  lookupBlockAtVideoTime,
  PersistedRenderedVideoMeta as PlayerPersistedMeta,
  ResolvedRenderedVideoMeta as PlayerResolvedMeta,
  validateMeta,
  videoTimeForBlock,
} from '../../../apps/goarrive/utils/renderedVideoOffsetMap';

const WORKOUT_ID = 'workout/contract #1';
const WORKOUT = {
  introVideoUrl: 'https://cdn.example.com/intro.mp4',
  blocks: [
    {
      type: 'Circuit',
      movements: [
        {
          id: 'movement-a',
          name: 'Squat',
          videoUrl: 'https://cdn.example.com/squat.mp4',
          duration: 30,
          restAfter: 15,
        },
      ],
    },
    {
      type: 'Circuit',
      movements: [
        {
          id: 'movement-b',
          name: 'Plank',
          thumbnailUrl: 'https://cdn.example.com/plank.jpg',
          duration: 45,
        },
      ],
      restDurationSeconds: 20,
    },
  ],
  outroVideoUrl: 'https://cdn.example.com/outro.mp4',
};

type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setPath(target: JsonRecord, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split('.');
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    const existing = current[part];
    if (!existing || typeof existing !== 'object') current[part] = {};
    current = current[part] as JsonRecord;
  });
  current[parts[parts.length - 1]] = value;
}

class FakeFirestore {
  data: JsonRecord;
  writes: JsonRecord[] = [];

  constructor(data: JsonRecord) {
    this.data = clone(data);
  }

  async runTransaction<T>(
    callback: (transaction: {
      get: (ref: unknown) => Promise<{ exists: boolean; data: () => JsonRecord }>;
      update: (ref: unknown, patch: JsonRecord) => void;
    }) => Promise<T>,
  ): Promise<T> {
    return callback({
      get: async () => ({ exists: true, data: () => clone(this.data) }),
      update: (_ref, patch) => {
        this.writes.push(patch);
        Object.entries(patch).forEach(([key, value]) => {
          if (key.includes('.')) setPath(this.data, key, value);
          else this.data[key] = value;
        });
      },
    });
  }
}

const fakeRef = {} as DocumentReference;

function asFirestore(fake: FakeFirestore): Firestore {
  return fake as unknown as Firestore;
}

describe('renderer × merged #263 timeline contract', () => {
  test('segment ids are deterministic, globally unique, reversible, and retain context', () => {
    const first = flattenWorkout(WORKOUT, WORKOUT_ID);
    const second = flattenWorkout(clone(WORKOUT), WORKOUT_ID);
    expect(second.map((segment) => segment.blockId)).toEqual(first.map((segment) => segment.blockId));
    expect(new Set(first.map((segment) => segment.blockId)).size).toBe(first.length);

    const decoded = first.map((segment) => decodeSegmentId(segment.blockId));
    expect(decoded.every(Boolean)).toBe(true);
    expect(decoded).toContainEqual(expect.objectContaining({
      workoutId: WORKOUT_ID,
      parentBlockId: 'block-0',
      blockIndex: 0,
      phase: 'work',
      movementId: 'movement-a',
      movementIndex: 0,
    }));
    expect(decoded).toContainEqual(expect.objectContaining({
      parentBlockId: 'block-0',
      phase: 'movement-rest',
      movementId: 'movement-a',
    }));
  });

  test('same-type blocks without ids cannot collide', () => {
    const segments = flattenWorkout(WORKOUT, WORKOUT_ID);
    const workSegments = segments.filter((segment) => segment.phase === 'work');
    expect(workSegments.map((segment) => segment.parentBlockId)).toEqual(['block-0', 'block-1']);
    expect(workSegments[0].blockId).not.toBe(workSegments[1].blockId);
  });

  test('actual persisted renderer output validates and round-trips without a fake URL', () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const metadata = buildReadyRenderedVideoMeta(
      'bucket.firebasestorage.app',
      WORKOUT_ID,
      { version: 7, sourceHash },
      flattenWorkout(WORKOUT, WORKOUT_ID),
    );
    const playerMeta: PlayerPersistedMeta = metadata;
    const resolvedMeta: PlayerResolvedMeta = {
      ...playerMeta,
      url: 'https://trusted-read.example.test/short-lived-url',
    };

    expect(Object.prototype.hasOwnProperty.call(metadata, 'url')).toBe(false);
    expect(validateMeta(playerMeta)).toEqual([]);
    expect(validateMeta(resolvedMeta)).toEqual([]);
    playerMeta.blocks.forEach((block) => {
      const time = videoTimeForBlock(playerMeta, block.blockId);
      expect(time).toBe(block.startMs);
      expect(lookupBlockAtVideoTime(playerMeta, time!).blockId).toBe(block.blockId);
    });
  });

  test('offsets and duration include only successfully emitted media', () => {
    const allSegments = flattenWorkout(WORKOUT, WORKOUT_ID);
    const omitted = allSegments[2];
    const emitted = allSegments.filter((segment) => segment !== omitted);
    const metadata = buildReadyRenderedVideoMeta(
      'bucket.firebasestorage.app',
      WORKOUT_ID,
      { version: 2, sourceHash: hashRenderSource(WORKOUT) },
      emitted,
    );

    expect(metadata.blocks.map((block) => block.blockId)).not.toContain(omitted.blockId);
    expect(metadata.durationMs).toBe(
      emitted.reduce((sum, segment) => sum + Math.round(segment.durationSec * 1000), 0),
    );
    expect(validateMeta(metadata)).toEqual([]);
  });
});

describe('durable storage and source identity', () => {
  test('source hash is canonical and changes for every rendered input class', () => {
    expect(hashRenderSource(WORKOUT)).toBe(hashRenderSource(clone(WORKOUT)));
    const changed = clone(WORKOUT) as JsonRecord;
    changed.restDurationSeconds = 99;
    expect(hashRenderSource(changed)).not.toBe(hashRenderSource(WORKOUT));
  });

  test('storage location is immutable, versioned, source-bound, and unsigned', () => {
    const identity = { version: 4, sourceHash: hashRenderSource(WORKOUT) };
    const location = buildRenderStorageLocation(
      'bucket.firebasestorage.app',
      WORKOUT_ID,
      identity,
    );
    expect(location.storagePath).toBe(
      `gs://bucket.firebasestorage.app/rendered-videos/${encodeURIComponent(WORKOUT_ID)}` +
      `/v4/${identity.sourceHash}.mp4`,
    );
    expect(location.storagePath).not.toMatch(/[?&](x-goog-|signature)/i);
  });
});

describe('atomic render state production helpers', () => {
  test('claim assigns one version and source hash atomically; duplicate claim is skipped', async () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const fake = new FakeFirestore({ ...WORKOUT, renderedVideo: { status: 'ready', version: 3 } });
    const first = await claimRenderRequest(asFirestore(fake), fakeRef, sourceHash);
    const second = await claimRenderRequest(asFirestore(fake), fakeRef, sourceHash);
    expect(first).toEqual({ version: 4, sourceHash });
    expect(second).toBeNull();
    expect(fake.data.renderedVideo).toEqual(expect.objectContaining({
      status: 'rendering',
      version: 4,
      sourceHash,
    }));
  });

  test('claim rejects an event whose source was superseded', async () => {
    const fake = new FakeFirestore({ ...WORKOUT, renderedVideo: { status: 'pending', version: 3 } });
    const staleHash = hashRenderSource({ ...WORKOUT, restDurationSeconds: 1 });
    expect(await claimRenderRequest(asFirestore(fake), fakeRef, staleHash)).toBeNull();
    expect(fake.writes).toHaveLength(0);
  });

  test('ready commit requires exact version, metadata hash, and live source hash', async () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const identity = { version: 4, sourceHash };
    const segments = flattenWorkout(WORKOUT, WORKOUT_ID);
    const metadata = buildReadyRenderedVideoMeta(
      'bucket.firebasestorage.app',
      WORKOUT_ID,
      identity,
      segments,
    );
    const fake = new FakeFirestore({ ...WORKOUT, renderedVideo: { status: 'rendering', ...identity } });
    expect(await commitReadyRenderIfCurrent(asFirestore(fake), fakeRef, identity, metadata)).toBe(true);
    expect(fake.data.renderedVideo).toEqual(expect.objectContaining({
      status: 'ready',
      version: 4,
      sourceHash,
      storagePath: metadata.storagePath,
    }));
  });

  test('equal version with a different source hash cannot commit ready state', async () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const identity = { version: 4, sourceHash };
    const metadata = buildReadyRenderedVideoMeta(
      'bucket.firebasestorage.app',
      WORKOUT_ID,
      identity,
      flattenWorkout(WORKOUT, WORKOUT_ID),
    );
    const changedWorkout = { ...WORKOUT, restDurationSeconds: 77 };
    const fake = new FakeFirestore({
      ...changedWorkout,
      renderedVideo: { status: 'rendering', version: 4, sourceHash: hashRenderSource(changedWorkout) },
    });
    expect(await commitReadyRenderIfCurrent(asFirestore(fake), fakeRef, identity, metadata)).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test('stale failure cannot mark a newer request failed', async () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const staleIdentity = { version: 4, sourceHash };
    const newerIdentity = { version: 5, sourceHash };
    const fake = new FakeFirestore({
      ...WORKOUT,
      renderedVideo: { status: 'rendering', ...newerIdentity },
    });
    expect(
      await commitFailedRenderIfCurrent(asFirestore(fake), fakeRef, staleIdentity, 'old failure'),
    ).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  test('current failure is committed and source changes invalidate the request', async () => {
    const sourceHash = hashRenderSource(WORKOUT);
    const identity = { version: 4, sourceHash };
    const fake = new FakeFirestore({ ...WORKOUT, renderedVideo: { status: 'rendering', ...identity } });
    expect(isCurrentRenderRequest(fake.data, identity)).toBe(true);
    expect(
      await commitFailedRenderIfCurrent(asFirestore(fake), fakeRef, identity, 'render failed'),
    ).toBe(true);
    expect(fake.data.renderedVideo).toEqual(expect.objectContaining({
      status: 'failed',
      version: 4,
      sourceHash,
      error: 'render failed',
    }));
  });
});

describe('private Cloud Run service target', () => {
  test('uses request path but service origin as OIDC audience', () => {
    expect(parseRenderServiceTarget('https://render-abc-uc.a.run.app/render/')).toEqual({
      targetUrl: 'https://render-abc-uc.a.run.app/render',
      audience: 'https://render-abc-uc.a.run.app',
    });
  });

  test.each([
    undefined,
    'http://render-abc-uc.a.run.app',
    'https://PLACEHOLDER.run.app/render',
    'https://example.com/render',
    'https://render-abc-uc.a.run.app:444/render',
    'https://render-abc-uc.a.run.app/render?token=nope',
  ])('rejects unsafe service target %p', (target) => {
    expect(() => parseRenderServiceTarget(target)).toThrow();
  });
});

describe('deploy build contract', () => {
  test('deploy compilation excludes tests and production source stays functions-local', () => {
    const functionsRoot = path.resolve(__dirname, '..', '..');
    const tsconfig = JSON.parse(fs.readFileSync(path.join(functionsRoot, 'tsconfig.json'), 'utf8'));
    const renderJobSource = fs.readFileSync(path.join(functionsRoot, 'src', 'renderJob.ts'), 'utf8');
    const dockerfile = fs.readFileSync(
      path.resolve(functionsRoot, '..', 'docker', 'renderWorkoutVideo.Dockerfile'),
      'utf8',
    );
    const runbook = fs.readFileSync(
      path.resolve(functionsRoot, '..', 'docs', 'render-workout-video-service.md'),
      'utf8',
    );

    expect(tsconfig.exclude).toContain('src/**/__tests__/**');
    expect(renderJobSource).not.toContain("from '../../apps/");
    expect(renderJobSource).toContain("from './renderContract'");
    expect(renderJobSource).toContain('if (require.main === module)');
    expect(renderJobSource).not.toContain('getSignedUrl');
    expect(dockerfile).toContain('rm -rf lib && npm run build && test -f lib/renderJob.js');
    expect(dockerfile).toContain('CMD ["node", "lib/renderJob.js"]');
    expect(runbook).toContain('RENDER_SERVICE_URL');
    expect(runbook).toContain('roles/run.invoker');
    expect(runbook).toContain('roles/cloudtasks.enqueuer');
    expect(runbook).toContain('roles/iam.serviceAccountUser');
    expect(runbook).not.toContain('RENDER_JOB_URL');
  });
});

// Compile-time assertion: production metadata is directly consumable by #263.
const _playerContract: PlayerPersistedMeta = buildReadyRenderedVideoMeta(
  'bucket.firebasestorage.app',
  WORKOUT_ID,
  { version: 1, sourceHash: hashRenderSource(WORKOUT) },
  flattenWorkout(WORKOUT, WORKOUT_ID) as Segment[],
);
void _playerContract;
