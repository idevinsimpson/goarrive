/**
 * MOVE-CAMERA-NATIVE-PORT-1 — the runtime-independent counting core.
 *
 * The lock, counter and session are ported from the accepted MOVEMENT-VISION-1
 * R&D core (PR #475, donor eda58218) as a TECHNICAL DONOR ONLY: PR #475 is not
 * merged. Its tests come with it, unchanged in substance, so the port is held
 * to exactly the behaviour that was reviewed.
 */
import { describe, expect, it, vi } from 'vitest';

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

import { depthFromRatio, squatRatio } from '../src/movement-camera/frozen/rep-counter-proof/core/geometry';
import { MovementSession, type SessionSnapshot } from '../src/movement-camera/frozen/rep-counter-proof/core/session';
import { SquatCounter, type SquatOutput } from '../src/movement-camera/frozen/rep-counter-proof/core/squatCounter';
import { SubjectLock } from '../src/movement-camera/frozen/rep-counter-proof/core/subjectLock';
import {
  syntheticPose,
  renderFrames,
  squatDepth,
  repeatedSquats,
  labDemoScene,
  type SyntheticPerson,
} from '../src/movement-camera/synthetic';
import type { Pose } from '../src/movement-camera/types';
import {
  ACQUIRING,
  ADJUST_MAX,
  cameraCue,
  cameraEntryAllowed,
  clampReps,
  COUNTDOWN_MS,
  DEFAULT_MOVE_CAMERA_SETTINGS,
  moveCameraSettingsOf,
  stepCountdown,
  type CountdownState,
} from '../src/movement-camera/flow';
import type { VisualPose } from '../src/movement-camera/types';
import { figureGeometry } from '../src/movement-camera/figure';
import { cameraCounterSupported, testPoseHook, type TestPoseHook } from '../src/movement-camera/support';
import { isFullBodyVisible, RepCounterOrchestrator, DEFAULT_FULL_BODY_STABLE_MS } from '../src/movement-camera/orchestrator';
import type { FrozenSession, FrozenSnapshot } from '../src/movement-camera/frozen';
import { BLAZEPOSE_INDEX, mapBlazePose, mapPerson, visualFor } from '../src/movement-camera/visual';
import { MEDIAPIPE_VERSION, MODEL_URL, WASM_BASE } from '../src/movement-camera/engine';
import {
  __resetMoveCameraSettingsCache,
  MOVE_CAMERA_SETTINGS_KEY,
  readMoveCameraSettings,
  writeMoveCameraSettings,
} from '../src/movement-camera/settingsStore';

/*
  The SquatCounter / SubjectLock / MovementSession / fail-closed suites below
  were PR #475's tests (donor eda58218). They now run against the FROZEN
  closure's core/ files, which are byte-identical to the donor's (pinned
  below). The PRODUCT counter is the frozen live session makeSessionR1421,
  exercised further down; MovementSession is not on the product path.
*/

// ─── ported from PR #475 tests/movement-squat-counter.test.ts (donor eda58218) ───
/** Feed a depth function at 30 fps over [0, endMs). Returns every output. */
function run(counter: SquatCounter, endMs: number, depthAt: (t: number) => number | null) {
  const outs: SquatOutput[] = [];
  for (let t = 0; t < endMs; t += 1000 / 30) outs.push(counter.update({ timestampMs: t, depth: depthAt(t) }));
  return outs;
}

const reps = (outs: SquatOutput[]) => outs.filter((o) => o.event === 'rep').length;

describe('SquatCounter — the rep state machine', () => {
  it('counts one full squat exactly once', () => {
    const c = new SquatCounter();
    const outs = run(c, 3000, (t) => squatDepth(t, 500, 1600, 1));
    expect(c.count).toBe(1);
    expect(reps(outs)).toBe(1);
    expect(outs.at(-1)!.phase).toBe('standing');
  });

  it('counts five reps as five', () => {
    const c = new SquatCounter();
    run(c, 12000, (t) => repeatedSquats(t, 500, 5, 1600, 1, 300));
    expect(c.count).toBe(5);
  });

  it('does not count a half squat, and reports it as a partial', () => {
    const c = new SquatCounter();
    const outs = run(c, 3000, (t) => squatDepth(t, 500, 1600, 0.45));
    expect(c.count).toBe(0);
    expect(outs.filter((o) => o.event === 'partial')).toHaveLength(1);
  });

  it('does not count a descent that stops just short of the down threshold', () => {
    const c = new SquatCounter();
    run(c, 3000, (t) => squatDepth(t, 500, 1600, 0.58));
    expect(c.count).toBe(0);
  });

  it('counts a slow squat (4 s down and up) once', () => {
    const c = new SquatCounter();
    run(c, 6000, (t) => squatDepth(t, 500, 4000, 1));
    expect(c.count).toBe(1);
  });

  it('counts fast squats (0.8 s each) one per rep', () => {
    const c = new SquatCounter();
    run(c, 6000, (t) => repeatedSquats(t, 300, 5, 800, 1, 150));
    expect(c.count).toBe(5);
  });

  it('a long pause at the bottom is still one rep', () => {
    const c = new SquatCounter();
    run(c, 7000, (t) => squatDepth(t, 500, 1600, 1, 4000));
    expect(c.count).toBe(1);
  });

  it('a long pause at the top adds nothing between reps', () => {
    const c = new SquatCounter();
    run(c, 12000, (t) => squatDepth(t, 500, 1600, 1) + squatDepth(t, 8000, 1600, 1));
    expect(c.count).toBe(2);
  });

  it('jitter across the down threshold at the bottom cannot double count', () => {
    const c = new SquatCounter();
    // Down, then 2 s of frame-by-frame chatter between 0.5 and 0.7 (either side
    // of downDepth 0.6), then back up.
    run(c, 5000, (t) => {
      if (t < 500) return 0;
      if (t < 1000) return ((t - 500) / 500) * 0.8;
      if (t < 3000) return Math.floor(t / 33) % 2 ? 0.7 : 0.5;
      if (t < 3500) return 0.8 - ((t - 3000) / 500) * 0.8;
      return 0;
    });
    expect(c.count).toBe(1);
  });

  it('bouncing between the thresholds without standing up is not a second rep', () => {
    const c = new SquatCounter();
    // Down, then three bounces up into the dead band (0.4) and back down.
    run(c, 6000, (t) => {
      if (t < 300) return 0;
      if (t < 4300) return 0.4 + 0.5 * Math.abs(Math.cos(((t - 300) / 1000) * Math.PI));
      return 0;
    });
    expect(c.count).toBe(1);
  });

  it('chatter across the UP threshold after a rep adds nothing', () => {
    const c = new SquatCounter();
    run(c, 5000, (t) => {
      const d = squatDepth(t, 300, 1400, 1);
      if (t > 1700 && t < 4500) return Math.floor(t / 33) % 2 ? 0.2 : 0.3; // around upDepth 0.25
      return d;
    });
    expect(c.count).toBe(1);
  });

  it('single noisy frames never move the phase (debounce)', () => {
    const c = new SquatCounter();
    // Standing, with one-frame spikes to full depth every 300 ms.
    run(c, 4000, (t) => (Math.floor(t / 33) % 9 === 0 ? 1.2 : 0));
    expect(c.count).toBe(0);
  });

  it('a spike that dwells only just under dwellMs does not count', () => {
    const c = new SquatCounter({ dwellMs: 100 });
    run(c, 2000, (t) => (t > 500 && t < 580 ? 1 : 0));
    expect(c.count).toBe(0);
  });

  it('interrupt() mid-rep discards the rep: returning to standing counts nothing', () => {
    const c = new SquatCounter();
    let t = 0;
    const feed = (d: number | null, ms: number) => {
      for (const end = t + ms; t < end; t += 33) c.update({ timestampMs: t, depth: d });
    };
    feed(0, 500); // standing
    feed(1, 500); // down
    expect(c.currentPhase).toBe('down');
    c.interrupt(); // tracking lost at the bottom
    feed(0, 800); // back standing
    expect(c.count).toBe(0);
    feed(1, 500);
    feed(0, 500); // a full rep after re-establishing standing
    expect(c.count).toBe(1);
  });

  it('starting in the down position counts nothing until standing is seen', () => {
    const c = new SquatCounter();
    run(c, 2000, (t) => (t < 1000 ? 1 : 0));
    expect(c.count).toBe(0);
  });

  it('null samples in the middle of a dwell cannot confirm it', () => {
    const c = new SquatCounter({ dwellMs: 100 });
    // Standing, then alternating [deep, null] — never two consecutive deep samples.
    run(c, 3000, (t) => (t < 500 ? 0 : Math.floor(t / 33) % 2 ? null : 1));
    // Never reaches down; and since #475 review case 2, the null during the
    // partial descent also voids it (phase unknown until standing is re-seen).
    expect(c.currentPhase).not.toBe('down');
    expect(c.count).toBe(0);
  });

  it('reset() zeroes the count and requires standing again', () => {
    const c = new SquatCounter();
    run(c, 3000, (t) => squatDepth(t, 500, 1600, 1));
    expect(c.count).toBe(1);
    c.reset();
    expect(c.count).toBe(0);
    expect(c.currentPhase).toBe('unknown');
  });

  it('refuses a configuration without hysteresis', () => {
    expect(() => new SquatCounter({ downDepth: 0.3, upDepth: 0.3 })).toThrow();
  });
});

// ─── ported from PR #475 tests/movement-subject-lock.test.ts (donor eda58218) ───
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

// ─── ported from PR #475 tests/movement-fail-closed.test.ts (donor eda58218) ───
/**
 * THE DIRECTOR'S THREE CONSTRUCTED CASES (#475 comment 5825938854), as
 * regressions. Each one reproduced a rep or a trusted subject that the core
 * should have refused. Inputs are the review's own, verbatim.
 */
const p = (depth = 0, cx = 0.5) => syntheticPose({ cx, footY: 0.92, height: 0.7, depth });
const f = (s: MovementSession, t: number, poses: ReturnType<typeof p>[]) => s.update({ timestampMs: t, poses });
const ready = () => {
  const s = new MovementSession();
  for (let t = 0; t <= 1000; t += 50) f(s, t, [p()]);
  expect(s.snapshot.lockState).toBe('locked');
  return s;
};

describe('fail-closed 1: two overlapping distinct poses are never one trusted person', () => {
  it('a second, almost identical pose next to the locked member makes the frame ambiguous', () => {
    const s = ready();
    const snap = f(s, 1050, [p(0, 0.5), p(0, 0.505)]);
    expect(snap.candidates).toHaveLength(2);
    expect(snap.counting).toBe(false);
    expect(snap).toMatchObject({ lockState: 'lost', lockReason: 'ambiguous' });
  });

  it('two overlapping people at acquisition are two people, not one', () => {
    const lock = new SubjectLock();
    let out;
    for (let t = 0; t <= 1500; t += 50) out = lock.update({ timestampMs: t, poses: [p(0, 0.5), p(0, 0.505)] });
    expect(out).toMatchObject({ state: 'searching', reason: 'twoPeople' });
  });
});

describe('fail-closed 2: an unobserved frame mid-rep voids the rep', () => {
  it('poses=[] while down, then standing, counts nothing', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    expect(s.snapshot.phase).toBe('down');
    const miss = f(s, 1350, []);
    expect(miss.counting).toBe(false);
    expect(miss.phase).toBe('unknown');
    for (let t = 1400; t <= 1550; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    // Re-armed by standing: the next fully observed rep counts.
    for (let t = 1600; t <= 1900; t += 50) f(s, t, [p(0.8)]);
    for (let t = 1950; t <= 2200; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(1);
  });

  it('a pose without a measurable leg mid-rep also voids it', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    f(s, 1350, [syntheticPose({ cx: 0.5, footY: 0.92, height: 0.7, depth: 0.8, hide: ['leftAnkle', 'rightAnkle'] })]);
    for (let t = 1400; t <= 1550; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });
});

describe('fail-closed 3: frames must be fresh and in order', () => {
  it('a long gap between down and standing cannot complete a rep', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    const after = f(s, 10000, [p(0)]);
    expect(after.counting).toBe(false);
    f(s, 10150, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });

  it('a gap just over the bound breaks the cycle; one just under does not', () => {
    const over = ready();
    for (let t = 1050; t <= 1300; t += 50) f(over, t, [p(0.8)]);
    for (let t = 1300 + 260, i = 0; i < 6; t += 50, i += 1) f(over, t, [p(0)]);
    expect(over.snapshot.reps).toBe(0);

    const under = ready();
    for (let t = 1050; t <= 1300; t += 50) f(under, t, [p(0.8)]);
    for (let t = 1300 + 240, i = 0; i < 6; t += 50, i += 1) f(under, t, [p(0)]);
    expect(under.snapshot.reps).toBe(1);
  });

  it('an out-of-order or repeated timestamp is rejected and voids the rep in progress', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    const stale = f(s, 1200, [p(0)]);
    expect(stale.counting).toBe(false);
    expect(stale.phase).toBe('unknown');
    const dup = f(s, 1300, [p(0)]);
    expect(dup.counting).toBe(false);
    for (let t = 1350; t <= 1600; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });

  it('SubjectLock itself ignores a non-increasing timestamp', () => {
    const lock = new SubjectLock();
    for (let t = 0; t <= 1000; t += 50) lock.update({ timestampMs: t, poses: [p()] });
    const out = lock.update({ timestampMs: 900, poses: [p()] });
    expect(out.subject).toBeNull();
  });
});

// ── MOVE-CAMERA-NATIVE-PORT-1 ─────────────────────────────────────────────────

const APP = nodePath.resolve(__dirname, '..');
const read = (p: string) => readFileSync(nodePath.join(APP, p), 'utf8');

/**
 * THE FROZEN CLOSURE, PINNED. sha256 of every file under
 * src/movement-camera/frozen/rep-counter-proof, as transcribed twice,
 * independently and byte-identically, from the owner-accepted Lovable
 * reference e15b9fa0@1454357098b9d066f310aee977455f5024c69d28
 * (src/lab/rep-counter-proof/; mediapipeVite.ts kept as .ts.txt because it
 * imports the reference's Vite asset manifests). A changed byte fails here.
 */
const FROZEN_SHA256: Record<string, string> = {
  'core/adapter.ts': 'a438ec3db2560f1d545085e4b5c84cce4a845a0a4b7a14d1303e0e49a02309fe',
  'core/geometry.ts': '7d1ede97153bbddaa5fe3186fd030ac2183e66f2217ebcaa308bb19a295bb52f',
  'core/session.ts': '614432144de16e35364d095b48cda1099e59a672ca95db86c1e45f70daf74603',
  'core/squatCounter.ts': '123bd171656041ea30cfd094fb499bf19d4b3434cab777b7f31ec24ec08d2868',
  'core/subjectLock.ts': 'a82898689565c6abaa5f2a1f97188f288942ff77a4958c51f55acedb6228b6b8',
  'core/types.ts': '327bd8b441d410519b8bfea772eb0c6981642c2bd54890b85b0c87634a4b7958',
  'core/web/cameraLifecycle.ts': '4936187a7756a74c1c5142e6c8f12c656971d54b28d5268a4916928dbcc93907',
  'mediapipeVite.ts.txt': '06e5d7f6c76af09412edd7fa1ff1d19f52c20e788250343d7ca3be283105f86f',
  'r10/naturalCounterR10.ts': '6c43831c3c38ee615bdb55c34503152e7f1f4821981055c90087d211f0222803',
  'r11/naturalCounterR11.ts': '8cf964da8d04b7589f85a2307041588aa1dbe40b4fffb4d3022710b44b8450d3',
  'r12/naturalCounterR12.ts': '1baa401a51458c48421549cdd7e7de97939dc521b9fb74d475985c2e1d75c518',
  'r12_2/naturalCounterR12_2.ts': '2637ed72228f908a66fde16a0baddca226bff853cf06a428460b2fd6139f33df',
  'r13/naturalCounterR13.ts': '6f2948867d488ede4230e34502fb9b4e5bca819db20c3075dd903c355c65a2a8',
  'r13/sideStabilizer.ts': 'a92d8bc2859daa8550558995c5f67d2a6f0f792a20af0d0f03576a31309d1dd6',
  'r13_1/skeletonFeatures.ts': '6eced4b3537ab115a8a77940991054f9caf1042ea6e47de5314503c09a48b476',
  'r13_2/naturalCounterR13_2.ts': '9bdf8ccbb8ef7f13e4cd1ca260625ca86ecc13d2200b5cc07a7890fb7d44b61c',
  'r13_2/signalReliability.ts': '86406e10cd6bac866070346d9fd1946a9d069fab06f80ce5b2b21ef52ab02463',
  'r13_3/cameraTransform.ts': 'f46f4d1fca944d171db000d7efeda76eb564cb3f10552e7934bcb88557d64243',
  'r13_3/naturalCounterR13_3.ts': '1efa2e7f24c419091902ce2ea6d9a0f9789047766caba385d95ec43b80b1d0a9',
  'r14/lockR14.ts': '93db093a143f7e336a6397305d1eb512ff008131225d71da3b378a513d052a99',
  'r14_1/gapGrace.ts': 'b6c22e9975f8ee56eb569a6a0790379dd642cd1173a2d47905ac4da8ef0ba7f9',
  'r14_2/sessionR142.ts': 'aaeaf207b14fbb8e7d48021cd5d33ed60466327d6687feff539f8268469ca94f',
  'r14_2/startupArm.ts': '5355a1a0981e09161fe55a1635d0dd64fd509758bcaa21270c3fea2b3282e543',
  'r5/lockR5.ts': '5b3b67c8df04f1b9abff6f803d27c8b05e8c3700c1fdce8b98b5c070043c28f1',
  'r5/sessionR5.ts': '95ad470c8b06a6be05da77a2868522d35d0c7f8acb372a27c855b5237a18cebf',
  'r6/frozenObserver.ts': '8499890416ec409c03b61bf31911bd7d1ad13472f39fb17ba313eeba4a9dc06e',
  'r6/geometryR6.ts': '267eae4af2862ee3c6b77c98210884ec03c320603efbf4ae7c851e32b6fcb620',
  'r6/naturalCounter.ts': '19a601a8014076a95464b94099d42fb91bc2031ab3b81fa68c9037026cff797c',
  'r7/lockR7.ts': 'ec376a3d4cd6794550e9b179e14dc040c94333cb66b1db8bd8661d154d4086e8',
  'r9/naturalCounterR9.ts': '0b010a4ef6f36d44caf5eb8dcdd5f78a755ee5e552693395529b04dc4d11bdfa',
  'replay/decision.ts': '64dc1dc87760e7bb0b09666271d360631680ff35a8fa925894a9fc1846934e80',
  'replay/traceOps.ts': '4143966cb7eaf80866548d58dd83964d11dbda79c86e910c9e17fd6ee5d09826'
};

describe('the frozen r14.2.1 closure is byte-for-byte what was accepted', () => {
  const root = nodePath.join(APP, 'src/movement-camera/frozen/rep-counter-proof');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = nodePath.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : [nodePath.relative(root, p)];
    });
  it('holds exactly the pinned files, no more and no fewer', () => {
    expect(files(root).sort()).toEqual(Object.keys(FROZEN_SHA256).sort());
  });
  it.each(Object.entries(FROZEN_SHA256))('%s is unchanged', (rel, sha) => {
    expect(createHash('sha256').update(readFileSync(nodePath.join(root, rel))).digest('hex')).toBe(sha);
  });
  it('the app reaches it only through the typed boundary (frozen.js)', () => {
    const appFiles = ['orchestrator.ts', 'controller.ts', 'engine.ts', 'visual.ts', 'flow.ts', 'figure.ts', 'types.ts', 'settingsStore.ts']
      .map((f) => read(`src/movement-camera/${f}`))
      .concat(read('src/ui/CameraRepCounter.tsx'), read('app/contribute/[goalId].tsx'));
    for (const code of appFiles) expect(code).not.toMatch(/from '[^']*rep-counter-proof/);
    expect(read('src/movement-camera/frozen.js')).toMatch(/makeSessionR1421 \} from '\.\/frozen\/rep-counter-proof\/r14_2\/sessionR142'/);
  });
  it('the orchestrator constructs the frozen live session, makeSessionR1421', () => {
    expect(read('src/movement-camera/orchestrator.ts')).toMatch(/opts\.makeSession \?\? makeSessionR1421/);
  });
  it('the BlazePose mapping is the frozen adapter mapping, character for character', () => {
    const frozen = read('src/movement-camera/frozen/rep-counter-proof/mediapipeVite.ts.txt');
    const ours = read('src/movement-camera/visual.ts');
    const fn = (code: string) => code.slice(code.indexOf('export function mapBlazePose'), code.indexOf('\n}\n', code.indexOf('export function mapBlazePose')) + 2);
    const idx = (code: string) => code.slice(code.indexOf('export const BLAZEPOSE_INDEX'), code.indexOf('};', code.indexOf('export const BLAZEPOSE_INDEX')) + 2);
    expect(fn(ours)).toBe(fn(frozen));
    expect(idx(ours)).toBe(idx(frozen));
    expect(frozen).toMatch(/MEDIAPIPE_VERSION = '0\.10\.35'/);
  });
});

describe('the engine: pinned version, no metrics logger, lazy', () => {
  it('the installed package and package.json are exactly 0.10.35 (no caret), with no odml logger', () => {
    const pkg = JSON.parse(read('node_modules/@mediapipe/tasks-vision/package.json'));
    expect(pkg.version).toBe(MEDIAPIPE_VERSION);
    expect(JSON.parse(read('package.json')).dependencies['@mediapipe/tasks-vision']).toBe('0.10.35');
    for (const b of ['vision_bundle.mjs', 'vision_bundle.cjs']) {
      expect(read(`node_modules/@mediapipe/tasks-vision/${b}`).includes('odml.pa.googleapis.com')).toBe(false);
    }
  });
  it('assets are pinned to this exact version and the lite float16 v1 model', () => {
    expect(WASM_BASE).toBe('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
    expect(MODEL_URL).toMatch(/pose_landmarker_lite\/float16\/1\/pose_landmarker_lite\.task$/);
  });
  it('the reference settings: VIDEO, numPoses 3, 0.5 confidences, no masks, GPU then CPU', () => {
    const code = read('src/movement-camera/engine.ts');
    for (const need of ["runningMode: 'VIDEO'", 'minPoseDetectionConfidence: 0.5', 'minPosePresenceConfidence: 0.5', 'minTrackingConfidence: 0.5', 'outputSegmentationMasks: false', "make('CPU')", 'mapPerson(raw)']) {
      expect(code, need).toContain(need);
    }
    expect(read('src/movement-camera/controller.ts')).toMatch(/createPoseEstimator\(3\)/);
  });
  it('the camera screen (and with it the controller, frozen counter and engine) is lazy on the contribute screen', () => {
    const code = read('app/contribute/[goalId].tsx');
    expect(code).toMatch(/lazy\(\(\) =>\s+import\('\.\.\/\.\.\/src\/ui\/CameraRepCounter'\)/);
    expect(code).not.toMatch(/^import .*CameraRepCounter/m);
    expect(code).not.toMatch(/^import .*movement-camera\/(controller|orchestrator|engine|frozen)/m);
    expect(read('src/movement-camera/support.ts')).not.toMatch(/^import (?!type).*'\.\/(controller|orchestrator|engine|frozen|visual)'/m);
  });
  it('the engine is reached only by dynamic import (its own chunk), never statically', () => {
    const all = ['src/movement-camera/controller.ts', 'src/ui/CameraRepCounter.tsx', 'app/contribute/[goalId].tsx', 'src/movement-camera/visual.ts'].map(read).join('\n');
    expect(all).not.toMatch(/from '[^']*\/engine'/);
    expect(all).not.toMatch(/from '[^']*tasksVision'/);
    expect(read('src/movement-camera/controller.ts')).toMatch(/await import\('\.\/engine'\)/);
    expect(read('src/movement-camera/engine.ts')).toMatch(/await import\('\.\/tasksVision'\)/);
    expect(read('src/movement-camera/engine.ts')).not.toMatch(/^import .*tasks-vision/m);
  });
});

const flowMember = (depth: number) => syntheticPose({ cx: 0.5, footY: 0.92, height: 0.7, depth });

/** A deterministic stand-in for the frozen session (the real one is exercised further down). */
function fakeSession() {
  const subject: Pose = {
    nose: { x: 0.5, y: 0.1, visibility: 0.9 }, leftShoulder: { x: 0.45, y: 0.25, visibility: 0.9 },
    leftHip: { x: 0.46, y: 0.5, visibility: 0.9 }, leftKnee: { x: 0.46, y: 0.7, visibility: 0.9 }, leftAnkle: { x: 0.46, y: 0.9, visibility: 0.9 },
  };
  const ctl = { reps: 0, armed: true, locked: true, resets: 0 };
  const snap = (): FrozenSnapshot => ({ reps: ctl.reps, lockState: ctl.locked ? 'locked' : 'searching', lockReason: null, subject: ctl.locked ? subject : null, armed: ctl.armed, frameIssue: null, counting: true });
  const session: FrozenSession = { update: () => snap(), reset: () => { ctl.resets += 1; ctl.reps = 0; return snap(); }, get snapshot() { return snap(); } };
  return { ctl, session };
}
const fakeFrame = (t: number) => ({ timestampMs: t, poses: [], aspect: 0.75 });

describe('orchestrator readiness + GO baseline (ported from the reference scripts/camera-counter.test.ts)', () => {
  it('ready requires armed AND 600 ms stable full body; beginSet refuses otherwise', () => {
    const { ctl, session } = fakeSession();
    const o = new RepCounterOrchestrator({ makeSession: () => session });
    o.beginRun(); o.setCamera('live');
    ctl.armed = false;
    for (let t = 0; t <= 800; t += 100) o.onFrame(fakeFrame(t));
    expect(o.snapshot().readyForCountdown).toBe(false);
    expect(o.beginSet()).toBe(false);
    ctl.armed = true;
    o.onFrame(fakeFrame(900));
    expect(o.snapshot().readyForCountdown).toBe(true);
    ctl.locked = false; o.onFrame(fakeFrame(1000));
    expect(o.snapshot().readyForCountdown).toBe(false);
  });
  it('ready only once full body has been stable for 600 ms of frame time, not before', () => {
    const { session } = fakeSession();
    const o = new RepCounterOrchestrator({ makeSession: () => session });
    o.beginRun(); o.setCamera('live');
    for (let t = 1000; t <= 1500; t += 100) o.onFrame(fakeFrame(t));
    expect(o.snapshot()).toMatchObject({ fullBodyStable: false, readyForCountdown: false });
    expect(o.beginSet()).toBe(false);
    o.onFrame(fakeFrame(1600));
    expect(o.snapshot()).toMatchObject({ fullBodyStable: true, readyForCountdown: true });
  });
  it('reps observed before GO never appear in the set, and GO does not reset the session', () => {
    const { ctl, session } = fakeSession();
    const o = new RepCounterOrchestrator({ makeSession: () => session });
    o.beginRun(); o.setCamera('live');
    for (let t = 0; t <= 700; t += 100) o.onFrame(fakeFrame(t));
    ctl.reps = 4; o.onFrame(fakeFrame(800));
    const resetsBefore = ctl.resets;
    expect(o.beginSet()).toBe(true);
    expect(ctl.resets).toBe(resetsBefore);
    expect(o.snapshot().setReps).toBe(0);
    ctl.reps = 7; o.onFrame(fakeFrame(900));
    expect(o.snapshot().setReps).toBe(3);
    expect(o.finishSet()).toEqual({ estimatedReps: 3, source: 'camera-estimate', verified: false });
  });
  it('a pause banks the set; the next run re-arms and a fresh GO resumes from the bank', () => {
    const { ctl, session } = fakeSession();
    const o = new RepCounterOrchestrator({ makeSession: () => session });
    o.beginRun(); o.setCamera('live');
    for (let t = 0; t <= 700; t += 100) o.onFrame(fakeFrame(t));
    o.beginSet();
    ctl.reps = 2; o.onFrame(fakeFrame(800));
    o.setCamera('paused');
    expect(o.snapshot()).toMatchObject({ phase: 'acquiring', setReps: 2 });
    o.beginRun(); o.setCamera('live');
    expect(o.beginSet()).toBe(false);
    for (let t = 1000; t <= 1700; t += 100) o.onFrame(fakeFrame(t));
    expect(o.beginSet()).toBe(true);
    ctl.reps = 1; o.onFrame(fakeFrame(1800));
    expect(o.snapshot().setReps).toBe(3);
  });
  it('Finish freezes the number', () => {
    const { ctl, session } = fakeSession();
    const o = new RepCounterOrchestrator({ makeSession: () => session });
    o.beginRun(); o.setCamera('live');
    for (let t = 0; t <= 700; t += 100) o.onFrame(fakeFrame(t));
    o.beginSet(); ctl.reps = 5; o.onFrame(fakeFrame(800));
    expect(o.finishSet().estimatedReps).toBe(5);
    ctl.reps = 9; o.onFrame(fakeFrame(900));
    expect(o.snapshot()).toMatchObject({ phase: 'finished', setReps: 5 });
  });
  it('full body is the nose plus one complete shoulder-hip-knee-ankle side, in frame', () => {
    const p = flowMember(0);
    expect(isFullBodyVisible(p)).toBe(true);
    expect(isFullBodyVisible({ ...p, nose: undefined })).toBe(false);
    const noLeft = { ...p, leftAnkle: undefined };
    expect(isFullBodyVisible(noLeft)).toBe(true);
    expect(isFullBodyVisible({ ...noLeft, rightKnee: { x: 0.5, y: 1.1, visibility: 0.9 } })).toBe(false);
    expect(DEFAULT_FULL_BODY_STABLE_MS).toBe(600);
  });
});

describe('the REAL frozen session (makeSessionR1421) through the orchestrator', () => {
  /** Synthetic stick figure at 30 fps, BlazePose-mapped like the engine output. NOT real-body evidence. */
  // Strictly increasing timestamps: a repeated one is an out-of-order frame,
  // which the frozen session (rightly) treats as an interruption.
  let last = -Infinity;
  function run(o: RepCounterOrchestrator, from: number, to: number, depthAt: (t: number) => number) {
    if (from === 0) last = -Infinity;
    for (let k = 0; ; k += 1) {
      const ts = Math.round((from + (k * 1000) / 30) * 1000) / 1000;
      if (ts >= to) break;
      if (ts <= last) continue;
      last = ts;
      o.onFrame({ timestampMs: ts, poses: [flowMember(depthAt(ts))], aspect: 9 / 16 });
    }
    return o.snapshot();
  }
  it('constructs without counting anything', () => {
    const o = new RepCounterOrchestrator();
    expect(o.snapshot()).toMatchObject({ setReps: 0, phase: 'idle' });
  });
  it('arms on a standing plateau and becomes ready after the stable window', () => {
    const o = new RepCounterOrchestrator();
    o.beginRun(); o.setCamera('live');
    const s = run(o, 0, 1500, () => 0);
    expect(s).toMatchObject({ locked: true, armed: true, fullBodyStable: true, readyForCountdown: true, phase: 'ready' });
  });
  it('pre-GO squats never reach the set; squats after GO do', () => {
    const o = new RepCounterOrchestrator();
    o.beginRun(); o.setCamera('live');
    run(o, 0, 1500, () => 0);
    run(o, 1500, 4000, (t) => repeatedSquats(t, 1500, 1, 1600, 0.95, 600));
    let s = run(o, 4000, 5000, () => 0);
    expect(s.rawRunReps).toBe(1);
    expect(o.beginSet()).toBe(true);
    expect(o.snapshot().setReps).toBe(0);
    s = run(o, 5000, 12000, (t) => repeatedSquats(t, 5000, 3, 1600, 0.95, 600));
    expect(s.rawRunReps).toBe(4);
    expect(s.setReps).toBe(3);
    expect(o.finishSet()).toEqual({ estimatedReps: 3, source: 'camera-estimate', verified: false });
  });
  it('a repeated (out-of-order) frame mid-rep voids that rep — fail closed', () => {
    const o = new RepCounterOrchestrator();
    o.beginRun(); o.setCamera('live');
    run(o, 0, 1500, () => 0);
    o.beginSet();
    run(o, 1500, 2300, (t) => repeatedSquats(t, 1500, 1, 1600, 0.95, 600));
    o.onFrame({ timestampMs: 2266.667, poses: [flowMember(0.9)], aspect: 9 / 16 });
    const s = run(o, 2300, 5000, (t) => repeatedSquats(t, 1500, 1, 1600, 0.95, 600));
    expect(s.setReps).toBe(0);
  });
  it('a shallow dip (a quarter squat) is not a rep', () => {
    const o = new RepCounterOrchestrator();
    o.beginRun(); o.setCamera('live');
    run(o, 0, 1500, () => 0);
    o.beginSet();
    const s = run(o, 1500, 6000, (t) => repeatedSquats(t, 1500, 2, 1600, 0.15, 600));
    expect(s.setReps).toBe(0);
  });
});

describe('camera settings', () => {
  it('default ON/ON, and a missing or malformed save reads as ON', () => {
    expect(DEFAULT_MOVE_CAMERA_SETTINGS).toEqual({ cameraCounter: true, stickFigure: true });
    expect(moveCameraSettingsOf(undefined)).toEqual({ cameraCounter: true, stickFigure: true });
    expect(moveCameraSettingsOf({ cameraCounter: 'no', stickFigure: 0 })).toEqual({ cameraCounter: true, stickFigure: true });
  });
  it('each toggle is kept independently', () => {
    expect(moveCameraSettingsOf({ cameraCounter: false })).toEqual({ cameraCounter: false, stickFigure: true });
    expect(moveCameraSettingsOf({ stickFigure: false })).toEqual({ cameraCounter: true, stickFigure: false });
  });
});

describe('camera entry', () => {
  const base = { settings: DEFAULT_MOVE_CAMERA_SETTINGS, unit: 'squats', mode: 'start' as const, resumed: false, supported: true };
  it('opens for a fresh squat Start moving with the counter on', () => {
    expect(cameraEntryAllowed(base)).toBe(true);
    expect(cameraEntryAllowed({ ...base, unit: ' Squats ' })).toBe(true);
  });
  it('never for another movement, a near-name, the counter off, Already moved, a resumed attempt, or an unsupported runtime', () => {
    for (const unit of ['push-ups', 'squat', 'jump squats', 'steps', '', null]) {
      expect(cameraEntryAllowed({ ...base, unit })).toBe(false);
    }
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: false, stickFigure: true } })).toBe(false);
    expect(cameraEntryAllowed({ ...base, mode: 'already' })).toBe(false);
    expect(cameraEntryAllowed({ ...base, resumed: true })).toBe(false);
    expect(cameraEntryAllowed({ ...base, supported: false })).toBe(false);
  });
  it('the stick figure setting alone never opens the camera', () => {
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: false, stickFigure: true } })).toBe(false);
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: true, stickFigure: false } })).toBe(true);
  });
});

describe('adjust bounds', () => {
  it('clamps to 0..500 and rounds', () => {
    expect(ADJUST_MAX).toBe(500);
    expect(clampReps(-3)).toBe(0);
    expect(clampReps(600)).toBe(500);
    expect(clampReps(7.6)).toBe(8);
    expect(clampReps(Number.NaN)).toBe(0);
    expect(clampReps(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('the automatic 3-2-1', () => {
  it('shows 3, 2, 1 and fires GO at 3000 ms', () => {
    let s: CountdownState = ACQUIRING;
    let r = stepCountdown(s, true, 1000);
    expect(r.display).toBe(3);
    s = r.state;
    expect(stepCountdown(s, true, 1000 + 900).display).toBe(3);
    expect(stepCountdown(s, true, 1000 + 1100).display).toBe(2);
    expect(stepCountdown(s, true, 1000 + 2100).display).toBe(1);
    r = stepCountdown(s, true, 1000 + COUNTDOWN_MS);
    expect(r.go).toBe(true);
    expect(r.state.phase).toBe('counting');
  });
  it('losing readiness mid-countdown returns to acquisition, and the next countdown starts over from 3', () => {
    const s = stepCountdown(ACQUIRING, true, 0).state;
    const lost = stepCountdown(s, false, 2500);
    expect(lost.state).toEqual(ACQUIRING);
    expect(lost.go).toBe(false);
    const again = stepCountdown(lost.state, true, 2600);
    expect(again.display).toBe(3);
    expect(stepCountdown(again.state, true, 2600 + 2999).go).toBe(false);
  });
  it('never fires GO without readiness', () => {
    expect(stepCountdown(ACQUIRING, false, 99999).go).toBe(false);
  });
});

describe('visual-only points never count (reference: visualEstimator)', () => {
  const raw33 = () => Array.from({ length: 33 }, (_, i) => ({ x: 0.3 + i / 100, y: 0.2 + i / 60, visibility: 0.9 }));
  it('mapPerson gives the counter exactly the nine frozen keypoints; arms and ears ride beside it', () => {
    const pose = mapPerson(raw33());
    expect(Object.keys(pose).sort()).toEqual(['leftAnkle', 'leftHip', 'leftKnee', 'leftShoulder', 'nose', 'rightAnkle', 'rightHip', 'rightKnee', 'rightShoulder']);
    const v = visualFor(pose);
    expect(v?.leftElbow?.x).toBeCloseTo(0.43);
    expect(v?.rightWrist?.x).toBeCloseTo(0.46);
    expect(v?.leftEar?.x).toBeCloseTo(0.37);
  });
  it('mapBlazePose ignores the visual indices entirely', () => {
    const r = raw33();
    const before = mapBlazePose(r);
    for (const i of [7, 8, 13, 14, 15, 16]) r[i] = { x: 9, y: 9, visibility: 1 };
    expect(mapBlazePose(r)).toEqual(before);
    expect(Object.values(BLAZEPOSE_INDEX).sort((a, b) => a - b)).toEqual([0, 11, 12, 23, 24, 25, 26, 27, 28]);
  });
  it('an off-frame joint is not visible; a joint without visibility is not visible', () => {
    const r = raw33();
    r[BLAZEPOSE_INDEX.rightAnkle] = { x: 0.5, y: 1.2, visibility: 0.99 };
    r[BLAZEPOSE_INDEX.leftKnee] = { x: 0.5, y: 0.7 } as never;
    const p = mapBlazePose(r);
    expect(p.rightAnkle!.visibility).toBe(0);
    expect(p.leftKnee!.visibility).toBe(0);
  });
});

describe('camera cues are plain', () => {
  const base = { status: 'live' as const, countingNow: false, countdown: null, locked: true, fullBody: true };
  it('maps each state to one plain line', () => {
    expect(cameraCue({ ...base, status: 'starting' })).toBe('Starting camera…');
    expect(cameraCue({ ...base, status: 'loadingModel' })).toBe('Starting camera…');
    expect(cameraCue({ ...base, locked: false })).toBe('Step back so I can see you');
    expect(cameraCue({ ...base, fullBody: false })).toBe('Step back so I can see you');
    expect(cameraCue(base)).toBe('Stand tall — getting ready');
    expect(cameraCue({ ...base, countdown: 2 })).toBe('Get ready');
    expect(cameraCue({ ...base, countingNow: true })).toBeNull();
    expect(cameraCue({ ...base, countingNow: true, locked: false })).toBe('Step back into view');
  });
  it('never shows diagnostics or R&D language', () => {
    const all = [true, false].flatMap((locked) =>
      [true, false].flatMap((countingNow) =>
        (['starting', 'loadingModel', 'live', 'paused', 'failed', 'off'] as const).map((status) =>
          cameraCue({ status, countingNow, countdown: null, locked, fullBody: locked }),
        ),
      ),
    );
    for (const s of all) expect(s ?? '').not.toMatch(/confidence|lock|track|pose|landmark|%|debug|model|arm/i);
  });
});

describe('the body guide geometry', () => {
  const vis: VisualPose = {
    leftEar: { x: 0.53, y: 0.2, visibility: 0.9 },
    rightEar: { x: 0.47, y: 0.2, visibility: 0.9 },
    leftElbow: { x: 0.62, y: 0.45, visibility: 0.9 },
    rightElbow: { x: 0.38, y: 0.45, visibility: 0.9 },
    leftWrist: { x: 0.64, y: 0.55, visibility: 0.9 },
    rightWrist: { x: 0.36, y: 0.55, visibility: 0.9 },
  };
  it('one figure: head ring, both arms and legs, torso sides and hips, no neck', () => {
    const g = figureGeometry(flowMember(0), vis, 9 / 16);
    expect(g.width).toBe(563);
    expect(g.lines).toHaveLength(8);
    expect(g.lines.map((l) => l.length).sort()).toEqual([2, 2, 2, 2, 3, 3, 3, 3]);
    expect(g.head!.cx).toBeCloseTo(0.5 * 563, 5);
    expect(g.head!.r).toBeGreaterThanOrEqual(26);
    expect(g.head!.r).toBeLessThanOrEqual(150);
  });
  it('a missing joint lifts the pen; a one-point chain is not drawn; no ears falls back to the nose', () => {
    const p = flowMember(0);
    delete p.leftKnee;
    const g = figureGeometry(p, { rightElbow: vis.rightElbow }, 1);
    expect(g.lines).toHaveLength(6);
    expect(g.head!.cx).toBeCloseTo(p.nose!.x * 1000, 5);
  });
});

describe('the synthetic test source is emulator + loopback only', () => {
  const hook: TestPoseHook = { scene: () => [] };
  const win = (hostname: string) => ({ location: { hostname }, __WSF_TEST_POSE__: hook });
  it('is read only on an emulator build served from loopback', () => {
    expect(testPoseHook('1', win('127.0.0.1'))).toBe(hook);
    expect(testPoseHook('true', win('localhost'))).toBe(hook);
    expect(testPoseHook(undefined, win('127.0.0.1'))).toBeNull();
    expect(testPoseHook('0', win('127.0.0.1'))).toBeNull();
    expect(testPoseHook('1', win('westayfit-app.web.app'))).toBeNull();
    expect(testPoseHook('1', { location: { hostname: '127.0.0.1' }, __WSF_TEST_POSE__: { scene: 'x' } })).toBeNull();
  });
  it('native (no window, no mediaDevices) is unsupported: fail closed to the manual flow', () => {
    expect(cameraCounterSupported()).toBe(false);
  });
});

describe('MOVE camera settings storage', () => {
  it('reads defaults with no storage, and a stored choice survives a fresh read', () => {
    const mem = new Map<string, string>();
    const ls = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    vi.stubGlobal('window', { localStorage: ls });
    try {
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
      writeMoveCameraSettings({ stickFigure: false });
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: false });
      mem.set(MOVE_CAMERA_SETTINGS_KEY, '{not json');
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
    } finally {
      vi.unstubAllGlobals();
      __resetMoveCameraSettingsCache();
    }
  });
});

describe('privacy: nothing leaves the device', () => {
  const files = [
    'src/ui/CameraRepCounter.tsx',
    'src/ui/CameraSkeletonOverlay.tsx',
    'src/movement-camera/controller.ts',
    'src/movement-camera/orchestrator.ts',
    'src/movement-camera/engine.ts',
    'src/movement-camera/visual.ts',
    'src/movement-camera/flow.ts',
    'src/movement-camera/figure.ts',
    'src/movement-camera/frozen.js',
  ];
  const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('no recording, canvas readback, upload, network, storage or Firestore in the camera path', () => {
    for (const f of files) {
      expect(strip(read(f)), f).not.toMatch(/MediaRecorder|captureStream|toDataURL|toBlob|getImageData|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|httpsCallable|firebase|firestore|odml\.pa\.googleapis|contributionFlow|pendingContribution/i);
    }
  });
  it('the frozen closure itself has no network, storage or recording either', () => {
    const root = nodePath.join(APP, 'src/movement-camera/frozen/rep-counter-proof');
    for (const rel of Object.keys(FROZEN_SHA256).filter((f) => f.endsWith('.ts'))) {
      expect(strip(readFileSync(nodePath.join(root, rel), 'utf8')), rel).not.toMatch(/MediaRecorder|toDataURL|getImageData|fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|firebase/i);
    }
  });
  it('the camera never asks for audio', () => {
    const code = read('src/movement-camera/controller.ts');
    expect(code.match(/audio: false/g)?.length).toBe(2);
    expect(code).not.toMatch(/audio: true/);
  });
  it('the camera screen disposes the controller on every way out', () => {
    const code = read('src/ui/CameraRepCounter.tsx');
    expect(code.match(/ctl\.dispose\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    const ctl = read('src/movement-camera/controller.ts');
    expect(ctl).toMatch(/visibilitychange/);
    expect(ctl).toMatch(/pagehide/);
  });
  it('the contribute screen opens the camera only before any write, never on a kiosk or over a round attempt', () => {
    const code = read('app/contribute/[goalId].tsx');
    const block = code.slice(code.indexOf('const cameraOpen ='), code.indexOf('if (cameraOpen) {'));
    for (const need of ["step === 'move'", '!cameraDeclined', '!kiosk', 'beforeWrite', '!legacyOrphan', "state.kind === 'ready'", 'roundAttemptRef.current != null', 'supported: cameraSupported']) {
      expect(block, need).toContain(need);
    }
    expect(code.indexOf('if (pending) {')).toBeLessThan(code.indexOf('const cameraOpen ='));
  });
});
