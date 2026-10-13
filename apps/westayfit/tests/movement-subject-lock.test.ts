import { describe, expect, it } from 'vitest';

import { depthFromRatio, squatRatio } from '../src/movement/geometry';
import { MovementSession, type SessionSnapshot } from '../src/movement/session';
import { SubjectLock } from '../src/movement/subjectLock';
import {
  renderFrames,
  repeatedSquats,
  squatDepth,
  syntheticPose,
  type SyntheticPerson,
} from '../src/movement/synthetic';
import type { Pose } from '../src/movement/types';

const MEMBER: SyntheticPerson = { cx: 0.5, footY: 0.92, height: 0.7, depth: 0 };

function play(session: MovementSession, fromMs: number, toMs: number, scene: (t: number) => Pose[]) {
  return renderFrames(fromMs, toMs, scene).map((f) => session.update(f));
}

const repsIn = (snaps: SessionSnapshot[]) => snaps.filter((s) => s.event === 'rep').length;

/** A session already locked on MEMBER, and the time at which it locked. */
function lockedSession(): { s: MovementSession; t: number } {
  const s = new MovementSession();
  const snaps = play(s, 0, 1500, () => [syntheticPose(MEMBER)]);
  expect(snaps.at(-1)!.lockState).toBe('locked');
  return { s, t: 1500 };
}

describe('geometry — the squat signal', () => {
  it('reads ~2 standing, ~1 at parallel, and maps to depth 0 → 1', () => {
    const stand = squatRatio(syntheticPose(MEMBER))!;
    const parallel = squatRatio(syntheticPose({ ...MEMBER, depth: 1 }))!;
    expect(stand).toBeCloseTo(2, 5);
    expect(parallel).toBeCloseTo(1, 5);
    expect(depthFromRatio(stand, 2)).toBeCloseTo(0, 5);
    expect(depthFromRatio(parallel, 2)).toBeCloseTo(1, 5);
  });

  it('is independent of distance to the camera', () => {
    const near = squatRatio(syntheticPose({ ...MEMBER, height: 0.9, depth: 0.5 }))!;
    const far = squatRatio(syntheticPose({ ...MEMBER, height: 0.35, depth: 0.5 }))!;
    expect(near).toBeCloseTo(far, 5);
  });

  it('is null when no leg is fully visible', () => {
    expect(
      squatRatio(syntheticPose({ ...MEMBER, hide: ['leftAnkle', 'rightAnkle'] })),
    ).toBeNull();
  });
});

describe('SubjectLock — acquisition', () => {
  it('locks one standing, full-body, centred person after holding still', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 1000, () => [syntheticPose(MEMBER)]).map((f) => lock.update(f));
    expect(outs[0].state).toBe('acquiring');
    const lockedAt = outs.findIndex((o) => o.state === 'locked');
    expect(lockedAt).toBeGreaterThan(15); // ≥ 600 ms at 30 fps
    expect(outs.at(-1)!.state).toBe('locked');
  });

  it('does not lock with nobody in frame', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => []).map((f) => lock.update(f));
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'noOne' });
  });

  it('does not lock when two people qualify — it refuses to choose', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 3000, () => [
      syntheticPose({ ...MEMBER, cx: 0.35 }),
      syntheticPose({ ...MEMBER, cx: 0.65 }),
    ]).map((f) => lock.update(f));
    expect(outs.every((o) => o.state === 'searching')).toBe(true);
    expect(outs.at(-1)!.reason).toBe('twoPeople');
  });

  it('locks the centred member, not a small background person off to the side', () => {
    const s = new MovementSession();
    play(s, 0, 1500, () => [
      syntheticPose({ cx: 0.9, footY: 0.6, height: 0.25, depth: 0 }),
      syntheticPose(MEMBER),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.subjectBox!.cx).toBeCloseTo(0.5, 1);
  });

  it('does not lock someone whose legs are out of frame', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => [
      syntheticPose({ ...MEMBER, hide: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] }),
    ]).map((f) => lock.update(f));
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'notFullBody' });
  });

  it('does not lock someone who is already squatting (standing baseline required)', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => [syntheticPose({ ...MEMBER, depth: 0.9 })]).map((f) =>
      lock.update(f),
    );
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'notStanding' });
  });

  it('does not lock someone walking across the zone (never holds still)', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2500, (t) => [syntheticPose({ ...MEMBER, cx: 0.2 + (t / 2500) * 0.6 })]).map(
      (f) => lock.update(f),
    );
    expect(outs.some((o) => o.state === 'locked')).toBe(false);
  });
});

describe('MovementSession — counting only the locked member', () => {
  it('counts the member’s full reps and ignores their half rep', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 9000, (ms) => {
      const d = repeatedSquats(ms, t + 200, 3, 1600, 1, 300) + squatDepth(ms, t + 6500, 1600, 0.4);
      return [syntheticPose({ ...MEMBER, depth: d })];
    });
    expect(s.snapshot.reps).toBe(3);
    expect(repsIn(snaps)).toBe(3);
    expect(snaps.some((x) => x.event === 'partial')).toBe(true);
  });

  it('a one-frame dropout mid-rep keeps the lock but voids that rep (unobserved = not countable)', () => {
    // Changed on the Director's review (#475 5825938854 case 2): this test
    // used to require the rep to SURVIVE a dropout. A cycle the counter did
    // not fully observe is now void; the next fully observed rep counts.
    const { s, t } = lockedSession();
    play(s, t, t + 5000, (ms) => {
      if (Math.abs(ms - (t + 1000)) < 20) return []; // one frame with nobody, at the bottom
      return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 200, 1600, 1) + squatDepth(ms, t + 2600, 1600, 1) })];
    });
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(1); // the second rep only
  });

  it('lost tracking at the bottom voids that rep, then re-acquires and counts the next', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 7000, (ms) => {
      const r = ms - t;
      if (r < 1000) return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t, 2000, 1) })]; // going down
      if (r < 2000) return []; // gone for a second while down
      if (r < 3500) return [syntheticPose(MEMBER)]; // back, standing
      return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 3800, 1600, 1) })];
    });
    const states = new Set(snaps.map((x) => x.lockState));
    expect(states.has('lost')).toBe(true);
    expect(snaps.find((x) => x.lockState === 'lost')!.lockReason).toBe('missing');
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(1); // the voided rep is not counted; the next one is
  });

  it('while lost, nothing is counted even if the member squats', () => {
    const { s, t } = lockedSession();
    // Member vanishes long enough to be lost, and a detection far away squats.
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ cx: 0.12, footY: 0.92, height: 0.7, depth: squatDepth(ms, t + 500, 1200, 1) }),
    ]);
    expect(snaps.some((x) => x.lockState === 'lost')).toBe(true);
    expect(s.snapshot.reps).toBe(0);
  });

  it('forgets after a long absence and must acquire from scratch', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 5000, () => []);
    expect(s.snapshot.lockState).toBe('searching');
  });

  it('a second person exercising at the edge of frame adds nothing', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 8000, (ms) => [
      syntheticPose(MEMBER), // member stands still
      syntheticPose({ cx: 0.1, footY: 0.9, height: 0.65, depth: repeatedSquats(ms, t, 5, 1200, 1, 200) }),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('with a second person exercising, only the member’s reps count', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 8000, (ms) => [
      syntheticPose({ ...MEMBER, depth: repeatedSquats(ms, t + 200, 2, 1600, 1, 400) }),
      syntheticPose({ cx: 0.1, footY: 0.9, height: 0.65, depth: repeatedSquats(ms, t, 5, 1200, 1, 200) }),
    ]);
    expect(s.snapshot.reps).toBe(2);
  });

  it('a person walking BEHIND the member pauses counting and never adds a rep', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 6000, (ms) => {
      const r = ms - t;
      const poses = [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 1200, 1400, 1) })];
      if (r < 3000) {
        poses.push(syntheticPose({ cx: 0.1 + (r / 3000) * 0.8, footY: 0.8, height: 0.55, depth: 0 }));
      }
      return poses;
    });
    const during = snaps.filter((x) => x.lockState === 'lost');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((x) => x.lockReason === 'ambiguous' || x.lockReason === 'missing')).toBe(true);
    expect(during.every((x) => !x.counting)).toBe(true);
    // The rep that happened while the walker overlapped the member is not
    // counted (not guessed); after they pass, the member is re-acquired.
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('a person walking briefly IN FRONT never steals the lock', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 6000, (ms) => {
      const r = ms - t;
      const walker = r > 500 && r < 2500 ? 0.1 + ((r - 500) / 2000) * 0.8 : null;
      // Closer to the camera: bigger, and while overlapping they hide the member.
      const hidden = walker !== null && Math.abs(walker - 0.5) < 0.12;
      const poses: Pose[] = [];
      if (!hidden) poses.push(syntheticPose(MEMBER));
      if (walker !== null) poses.push(syntheticPose({ cx: walker, footY: 0.98, height: 0.8, depth: 0 }));
      return poses;
    });
    // At no point is the walker's box the tracked box.
    for (const x of snaps) {
      if (x.lockState === 'locked') expect(x.subjectBox!.cx).toBeCloseTo(0.5, 1);
    }
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('a second person arriving next to the member and staying makes it ambiguous, not a guess', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 500, 1600, 1) }),
      syntheticPose({ ...MEMBER, cx: 0.62, depth: squatDepth(ms, t + 500, 1600, 1) }),
    ]);
    expect(snaps.at(-1)).toMatchObject({ lockState: 'lost', lockReason: 'ambiguous' });
    expect(s.snapshot.reps).toBe(0);
  });

  it('the member drifting slowly (phone nudged) stays locked and keeps counting', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 7000, (ms) => [
      syntheticPose({
        ...MEMBER,
        cx: 0.5 + ((ms - t) / 7000) * 0.1,
        height: 0.7 * (1 - ((ms - t) / 7000) * 0.1),
        depth: repeatedSquats(ms, t + 200, 3, 1600, 1, 400),
      }),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(3);
  });

  it('low-confidence landmarks count as not seen — the counter pauses', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ ...MEMBER, visibility: 0.3, depth: squatDepth(ms, t + 300, 1600, 1) }),
    ]);
    expect(snaps.every((x) => !x.counting)).toBe(true);
    expect(s.snapshot.lockState).toBe('lost');
    expect(s.snapshot.reps).toBe(0);
  });
});

describe('MovementSession — manual fallback and reset', () => {
  it('manual mode counts taps, never goes below zero, and ignores camera frames', () => {
    const s = new MovementSession();
    s.useManual();
    s.tap(1);
    s.tap(1);
    s.tap(-1);
    s.tap(-1);
    s.tap(-1);
    expect(s.snapshot).toMatchObject({ mode: 'manual', reps: 0 });
    s.tap(1);
    play(s, 0, 5000, (ms) => [syntheticPose({ ...MEMBER, depth: repeatedSquats(ms, 1000, 2, 1600, 1) })]);
    expect(s.snapshot).toMatchObject({ mode: 'manual', reps: 1 });
  });

  it('switching to manual carries the camera count over', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 3000, (ms) => [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 200, 1600, 1) })]);
    expect(s.snapshot.reps).toBe(1);
    s.useManual();
    s.tap(1);
    expect(s.snapshot.reps).toBe(2);
  });

  it('reset() returns to camera mode, zero, searching', () => {
    const s = new MovementSession();
    s.useManual();
    s.tap(1);
    s.reset();
    expect(s.snapshot).toMatchObject({ mode: 'camera', reps: 0, lockState: 'searching' });
  });
});
