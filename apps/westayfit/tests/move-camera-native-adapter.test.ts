/**
 * NATIVE-CAMERA-1 — the native squat camera adapter (iOS/Android).
 *
 * What runs here is the JavaScript side, for real: the pure event → PoseFrame
 * adapter (nativeEngine.ts), the native controller (controller.native.ts), the
 * fail-closed support probe (support.native.ts), the react-native-svg overlay
 * and the preview slot, all against the UNCHANGED orchestrator and the REAL
 * frozen session. Native events are synthetic, shaped exactly as the Swift and
 * Kotlin code sends them (iOS ms, Android ns).
 *
 * What does NOT run here: the Swift and Kotlin code. It is UNCOMPILED in the
 * sprint sandbox; the static checks below only hold its settings, wiring,
 * privacy surface and model to the contract. Nothing here is evidence that
 * the camera works or counts accurately on a real body or device.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

const fakeView = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('expo', async () => {
  const { createElement: h } = await import('react');
  const PoseCameraView = (props: Record<string, unknown>) => {
    fakeView.props.push(props);
    return h('div', { 'data-testid': props.testID, 'data-active': String(props.active), 'data-run': String(props.runId) });
  };
  return {
    requireOptionalNativeModule: vi.fn(() => null),
    requireNativeView: vi.fn(() => PoseCameraView),
  };
});

vi.mock('react-native-svg', async () => {
  const { createElement: h } = await import('react');
  const host = (tag: string) => (props: Record<string, unknown>) => h(tag, props);
  return { default: host('svg'), Svg: host('svg'), G: host('g'), Path: host('path'), Circle: host('circle') };
});

import { requireNativeView, requireOptionalNativeModule } from 'expo';

import {
  loadWsfPoseCameraModule,
  MODEL_FILE,
  MODEL_SHA256,
  WSF_POSE_CAMERA_MODULE,
  type PoseEventPayload,
  type WsfPoseCameraNativeModule,
} from '../modules/wsf-pose-camera';
import { RepCounterController as WebController } from '../src/movement-camera/controller';
import { cameraEntryAllowed, DEFAULT_MOVE_CAMERA_SETTINGS } from '../src/movement-camera/flow';
import {
  REQUESTED_CAMERA as NATIVE_REQUESTED_CAMERA,
  RepCounterController as NativeController,
  type AppStateLike,
} from '../src/movement-camera/controller.native';
import { MEDIAPIPE_VERSION, MODEL_URL } from '../src/movement-camera/engine';
import { figureGeometry } from '../src/movement-camera/figure';
import {
  isNativeCameraHost,
  NATIVE_MAX_POSES,
  NativeFrameGate,
  NS_GUARD,
  rawPeople,
  timestampMsOf,
  toPoseFrame,
  type NativeCameraBinding,
} from '../src/movement-camera/nativeEngine';
import { RepCounterOrchestrator, type RepCounterSnapshot } from '../src/movement-camera/orchestrator';
import * as nativeSupport from '../src/movement-camera/support.native';
import { labDemoScene, repeatedSquats, syntheticPose, type SyntheticPerson } from '../src/movement-camera/synthetic';
import type { Keypoint, Pose } from '../src/movement-camera/types';
import { BLAZEPOSE_INDEX, mapBlazePose, mapPerson, VISUAL_INDEX, visualFor, type RawLandmark } from '../src/movement-camera/visual';
import { CameraSkeletonOverlay } from '../src/ui/CameraSkeletonOverlay.native';
import { NativeCameraPreview } from '../src/ui/NativeCameraPreview.native';
import { NativeCameraPreview as WebNativeCameraPreview } from '../src/ui/NativeCameraPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = nodePath.resolve(__dirname, '..');
const MOD = 'modules/wsf-pose-camera';
const read = (p: string) => readFileSync(nodePath.join(APP, p), 'utf8');
/**
 * Code without comments: block comments and comment-only lines are removed. A `//` after code, or
 * inside a string literal ("a//b"), is kept and scanned, so it cannot hide code from the scan.
 */
const strip = (c: string) =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
const filesUnder = (dir: string): string[] =>
  readdirSync(nodePath.join(APP, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(nodePath.join(APP, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });

// ── Synthetic native events, shaped exactly as the Swift / Kotlin code sends them ──

/** A camera clock about 3 days after boot (ms). */
const BOOT_MS = 3 * 24 * 3600 * 1000;
type Platform = 'ios' | 'android';

/** A synthetic 9-point member → the full 33-landmark BlazePose list MediaPipe returns. */
function rawFromPose(p: Pose): RawLandmark[] {
  const raw: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
  for (const [k, i] of Object.entries(BLAZEPOSE_INDEX) as [Keypoint, number][]) {
    const lm = p[k];
    // A point the engine "did not see" still has coordinates, with ~0 visibility.
    raw[i] = lm ? { x: lm.x, y: lm.y, visibility: lm.visibility } : { x: 0.5, y: 0.5, visibility: 0.0 };
  }
  const nose = p.nose;
  const ls = p.leftShoulder;
  const rs = p.rightShoulder;
  const lh = p.leftHip;
  const rh = p.rightHip;
  if (nose) {
    raw[VISUAL_INDEX.leftEar] = { x: nose.x + 0.03, y: nose.y, visibility: 0.9 };
    raw[VISUAL_INDEX.rightEar] = { x: nose.x - 0.03, y: nose.y, visibility: 0.9 };
  }
  if (ls && lh) {
    raw[VISUAL_INDEX.leftElbow] = { x: ls.x + 0.04, y: (ls.y + lh.y) / 2, visibility: 0.9 };
    raw[VISUAL_INDEX.leftWrist] = { x: lh.x + 0.05, y: lh.y, visibility: 0.9 };
  }
  if (rs && rh) {
    raw[VISUAL_INDEX.rightElbow] = { x: rs.x - 0.04, y: (rs.y + rh.y) / 2, visibility: 0.9 };
    raw[VISUAL_INDEX.rightWrist] = { x: rh.x - 0.05, y: rh.y, visibility: 0.9 };
  }
  return raw;
}

const flat = (raw: RawLandmark[]) => raw.flatMap((l) => [l.x, l.y, typeof l.visibility === 'number' ? l.visibility : -1]);

function nativeEvent(
  poses: Pose[],
  tMs: number,
  platform: Platform,
  extra: Partial<PoseEventPayload> = {},
): PoseEventPayload {
  return {
    runId: 1,
    // iOS: integer ms (presentation time × 1000, floored). Android: ns, with sub-ms detail.
    timestamp: platform === 'ios' ? BOOT_MS + tMs : (BOOT_MS + tMs) * 1e6 + 437,
    timestampUnit: platform === 'ios' ? 'ms' : 'ns',
    width: 480,
    height: 640,
    mirrored: false,
    people: poses.map((p) => flat(rawFromPose(p))),
    ...extra,
  };
}

/** Integer-ms frame times at 30 fps over [from, to). */
const frameTimes = (from: number, to: number, fps = 30) => {
  const out: number[] = [];
  for (let k = 0; ; k += 1) {
    const t = from + Math.round((k * 1000) / fps);
    if (t >= to) break;
    out.push(t);
  }
  return out;
};

const MEMBER: SyntheticPerson = { cx: 0.5, footY: 0.92, height: 0.7, depth: 0 };
const member = (depth: number) => syntheticPose({ ...MEMBER, depth });

/** The orchestrator fed through the native adapter (what controller.native does per event). */
function nativePath() {
  const o = new RepCounterOrchestrator();
  o.beginRun();
  o.setCamera('live');
  const gate = new NativeFrameGate();
  const snaps: RepCounterSnapshot[] = [];
  return {
    o,
    gate,
    snaps,
    feed(ev: unknown) {
      const r = gate.accept(ev);
      if (r.ok) snaps.push(o.onFrame(r.frame));
      return r;
    },
  };
}

/** The orchestrator fed the web way (engine.ts: mapPerson per person, aspect = w / h). */
function webPath(aspect = 480 / 640) {
  const o = new RepCounterOrchestrator();
  o.beginRun();
  o.setCamera('live');
  const snaps: RepCounterSnapshot[] = [];
  return {
    o,
    snaps,
    feed(poses: Pose[], tMs: number) {
      snaps.push(o.onFrame({ timestampMs: BOOT_MS + tMs, poses: poses.map((p) => mapPerson(rawFromPose(p))), aspect }));
    },
  };
}

const outcome = (s: RepCounterSnapshot) => ({
  phase: s.phase,
  rawRunReps: s.rawRunReps,
  setReps: s.setReps,
  locked: s.locked,
  armed: s.armed,
  fresh: s.fresh,
  fullBodyVisible: s.fullBodyVisible,
  readyForCountdown: s.readyForCountdown,
  // Coordinates and wording too, so a change that keeps the count cannot pass as parity.
  keypoints: s.keypoints,
  aspect: s.aspect,
  guidance: s.guidance,
});

/** The existing real-session scenario: stand, one pre-GO squat, stand, GO, three squats. */
function standardSet(feed: (poses: Pose[], t: number) => void, beginSet: () => boolean) {
  for (const t of frameTimes(0, 1500)) feed([member(0)], t);
  for (const t of frameTimes(1500, 4000)) feed([member(repeatedSquats(t, 1500, 1, 1600, 0.95, 600))], t);
  for (const t of frameTimes(4000, 5000)) feed([member(0)], t);
  const go = beginSet();
  for (const t of frameTimes(5000, 12000)) feed([member(repeatedSquats(t, 5000, 3, 1600, 0.95, 600))], t);
  return go;
}

// ── 1. The pure adapter ─────────────────────────────────────────────────────

describe('nativeEngine.toPoseFrame — one native event → one PoseFrame', () => {
  it('maps every person with the SAME mapPerson as web: nine counting points, visual extras beside them', () => {
    const ev = nativeEvent([member(0)], 100, 'ios');
    const r = toPoseFrame(ev, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = rawFromPose(member(0));
    expect(r.frame.poses).toHaveLength(1);
    expect(r.frame.poses[0]).toEqual(mapBlazePose(raw));
    expect(Object.keys(r.frame.poses[0]).sort()).toEqual(Object.keys(BLAZEPOSE_INDEX).sort());
    const vis = visualFor(r.frame.poses[0]);
    expect(Object.keys(vis ?? {}).sort()).toEqual(Object.keys(VISUAL_INDEX).sort());
    expect(r.frame.timestampMs).toBe(BOOT_MS + 100);
  });

  it('aspect is the upright width / height (portrait 480x640 → 0.75; landscape → 4/3)', () => {
    const p = toPoseFrame(nativeEvent([member(0)], 0, 'ios'), null);
    const l = toPoseFrame(nativeEvent([member(0)], 0, 'ios', { width: 640, height: 480 }), null);
    expect(p.ok && p.frame.aspect).toBeCloseTo(0.75, 12);
    expect(l.ok && l.frame.aspect).toBeCloseTo(4 / 3, 12);
  });

  it('Android ns → ms; iOS ms stays ms', () => {
    expect(timestampMsOf({ timestamp: 123_456_789_000_000, timestampUnit: 'ns' })).toBe(123_456_789);
    expect(timestampMsOf({ timestamp: 1_500_000, timestampUnit: 'ns' })).toBe(1.5);
    expect(timestampMsOf({ timestamp: 98_765.5, timestampUnit: 'ms' })).toBe(98_765.5);
    const a = toPoseFrame(nativeEvent([member(0)], 33, 'android'), null);
    expect(a.ok && a.frame.timestampMs).toBeCloseTo(BOOT_MS + 33 + 0.000437, 6);
    // A ns clock would be ~33,000,000 "ms" between frames if left unconverted.
    const b = toPoseFrame(nativeEvent([member(0)], 66, 'android'), null);
    expect(a.ok && b.ok && b.frame.timestampMs - a.frame.timestampMs).toBeCloseTo(33, 6);
  });

  it('the unit is required: an unlabelled clock is dropped, never guessed; a clock LABELLED ms above 1e12 is dropped too', () => {
    expect(NS_GUARD).toBe(1e12);
    expect(timestampMsOf({ timestamp: 2.5e14 })).toBeNull();
    expect(timestampMsOf({ timestamp: 2.5e8 })).toBeNull();
    expect(timestampMsOf({ timestamp: 2.5e14, timestampUnit: 'ns' })).toBe(2.5e8);
    expect(timestampMsOf({ timestamp: 2.5e14, timestampUnit: 'ms' })).toBeNull();
    expect(toPoseFrame({ ...nativeEvent([], 0, 'android'), timestampUnit: 'ms' }, null)).toEqual({ ok: false, drop: 'invalid' });
    const { timestampUnit: _unit, ...unlabelled } = nativeEvent([member(0)], 0, 'ios');
    expect(toPoseFrame(unlabelled, null)).toEqual({ ok: false, drop: 'invalid' });
  });

  it('rejects what cannot be trusted: bad timestamp, unknown unit, no usable size, no people array', () => {
    const ok = nativeEvent([member(0)], 0, 'ios');
    const bad: unknown[] = [
      null,
      undefined,
      42,
      { ...ok, timestamp: Number.NaN },
      { ...ok, timestamp: -1 },
      { ...ok, timestamp: '100' },
      { ...ok, timestampUnit: 'us' },
      { ...ok, width: 0 },
      { ...ok, height: -640 },
      { ...ok, width: Number.POSITIVE_INFINITY },
      { ...ok, height: undefined },
      { ...ok, people: undefined },
      { ...ok, people: 'x' },
    ];
    for (const ev of bad) expect(toPoseFrame(ev, null), JSON.stringify(ev)).toEqual({ ok: false, drop: 'invalid' });
  });

  it('strictly increasing: a repeated timestamp is a duplicate, an older one is out of order; neither is re-timed', () => {
    const t = BOOT_MS + 200;
    expect(toPoseFrame(nativeEvent([member(0)], 200, 'ios'), t)).toEqual({ ok: false, drop: 'duplicate' });
    expect(toPoseFrame(nativeEvent([member(0)], 199, 'ios'), t)).toEqual({ ok: false, drop: 'outOfOrder' });
    const next = toPoseFrame(nativeEvent([member(0)], 201, 'ios'), t);
    expect(next.ok && next.frame.timestampMs).toBe(t + 1);
  });

  it('coordinates stay the UNMIRRORED frame; an event that says mirrored is flipped back (x only)', () => {
    const plain = toPoseFrame(nativeEvent([member(0)], 0, 'ios'), null);
    const raw = rawFromPose(member(0));
    const mirroredEv = nativeEvent([], 0, 'ios', { mirrored: true, people: [flat(raw.map((l) => ({ ...l, x: 1 - l.x })))] });
    const back = toPoseFrame(mirroredEv, null);
    expect(plain.ok && back.ok).toBe(true);
    if (!plain.ok || !back.ok) return;
    for (const k of Object.keys(BLAZEPOSE_INDEX) as Keypoint[]) {
      expect(back.frame.poses[0][k]!.x).toBeCloseTo(plain.frame.poses[0][k]!.x, 12);
      expect(back.frame.poses[0][k]!.y).toBe(plain.frame.poses[0][k]!.y);
    }
  });

  it('visibility is always present on what reaches the counter; a missing one (-1) is 0, never invented', () => {
    const raw = rawFromPose(member(0));
    raw[BLAZEPOSE_INDEX.leftKnee] = { x: 0.4, y: 0.7 }; // engine reported no visibility → sent as -1
    raw[BLAZEPOSE_INDEX.rightKnee] = { x: 1.2, y: 0.7, visibility: 0.99 }; // out of frame
    const r = toPoseFrame(nativeEvent([], 0, 'ios', { people: [flat(raw)] }), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pose = r.frame.poses[0];
    for (const k of Object.keys(BLAZEPOSE_INDEX) as Keypoint[]) expect(typeof pose[k]!.visibility).toBe('number');
    expect(pose.leftKnee!.visibility).toBe(0);
    expect(pose.rightKnee!.visibility).toBe(0);
    expect(pose.nose!.visibility).toBe(raw[0].visibility);
    expect(rawPeople({ people: [[0.1, 0.2, -1]] })[0][0]).toEqual({ x: 0.1, y: 0.2 });
  });

  it('numPoses semantics: nobody → an empty frame (kept), at most 3 people, malformed people skipped', () => {
    expect(NATIVE_MAX_POSES).toBe(3);
    const empty = toPoseFrame(nativeEvent([], 0, 'android'), null);
    expect(empty.ok && empty.frame.poses).toEqual([]);
    const four = [0.2, 0.4, 0.6, 0.8].map((cx) => syntheticPose({ ...MEMBER, cx, height: 0.4 }));
    const capped = toPoseFrame(nativeEvent(four, 0, 'android'), null);
    expect(capped.ok && capped.frame.poses).toHaveLength(3);
    expect(capped.ok && capped.frame.poses[2].nose!.x).toBeCloseTo(0.6, 12);
    const junk = toPoseFrame(nativeEvent([], 0, 'ios', { people: ['x', null, flat(rawFromPose(member(0)))] as unknown as number[][] }), null);
    expect(junk.ok && junk.frame.poses).toHaveLength(1);
    const short = rawPeople({ people: [[0.5, 0.1, 0.9]] });
    expect(short[0]).toHaveLength(1);
    expect(mapBlazePose(short[0])).toEqual({ nose: { x: 0.5, y: 0.1, visibility: 0.9 } });
  });

  it('the per-run gate keeps accepted timestamps strictly increasing and counts what it dropped', () => {
    const gate = new NativeFrameGate();
    const seq = [0, 33, 33, 66, 50, 100, 100, 133];
    const accepted: number[] = [];
    for (const t of seq) {
      const r = gate.accept(nativeEvent([member(0)], t, 'android'));
      if (r.ok) accepted.push(r.frame.timestampMs);
    }
    gate.accept({ nope: true });
    expect(accepted).toHaveLength(5);
    for (let i = 1; i < accepted.length; i += 1) expect(accepted[i]).toBeGreaterThan(accepted[i - 1]);
    expect(gate.stats).toEqual({ accepted: 5, invalid: 1, duplicate: 2, outOfOrder: 1 });
  });
});

// ── 2. Parity with the web path through the REAL frozen session ─────────────

describe('adapter parity: native events → the REAL frozen session behave exactly as the web path', () => {
  for (const platform of ['ios', 'android'] as Platform[]) {
    it(`${platform}: the standard set gives raw 4 / set 3, frame for frame identical to web`, () => {
      const n = nativePath();
      const w = webPath();
      const goN = standardSet((poses, t) => n.feed(nativeEvent(poses, t, platform)), () => n.o.beginSet());
      const goW = standardSet((poses, t) => w.feed(poses, t), () => w.o.beginSet());
      expect(goN).toBe(true);
      expect(goW).toBe(true);
      expect(n.snaps.map(outcome)).toEqual(w.snaps.map(outcome));
      expect(n.o.snapshot()).toMatchObject({ rawRunReps: 4, setReps: 3 });
      expect(n.gate.stats).toMatchObject({ duplicate: 0, outOfOrder: 0, invalid: 0 });
    });
  }

  it('multiple people (the lab scene: a bystander walks behind, another squats at the edge): native = web, bystanders add nothing', () => {
    const scene = (t: number) => labDemoScene(t).slice(0, NATIVE_MAX_POSES);
    const memberOnly = (t: number) => labDemoScene(t).filter((p) => Math.abs(p.nose!.x - 0.5) < 0.6 && p.leftAnkle!.y > 0.91).slice(0, 1);
    const run = (fn: (t: number) => Pose[]) => {
      const n = nativePath();
      const w = webPath();
      let maxPeople = 0;
      for (const t of frameTimes(0, 19000)) {
        const poses = fn(t);
        maxPeople = Math.max(maxPeople, poses.length);
        n.feed(nativeEvent(poses, t, 'android'));
        w.feed(poses, t);
      }
      return { n, w, maxPeople };
    };
    const all = run(scene);
    expect(all.maxPeople).toBe(2);
    expect(all.n.snaps.map(outcome)).toEqual(all.w.snaps.map(outcome));
    const alone = run(memberOnly);
    expect(alone.maxPeople).toBe(1);
    expect(all.n.o.snapshot().rawRunReps).toBeLessThanOrEqual(alone.n.o.snapshot().rawRunReps);
    expect(all.n.o.snapshot().rawRunReps).toBeGreaterThan(0);
  });

  it('tracking loss: frames with nobody are delivered (not dropped), the count holds, "Step back into view", then counting resumes', () => {
    const n = nativePath();
    for (const t of frameTimes(0, 1500)) n.feed(nativeEvent([member(0)], t, 'ios'));
    expect(n.o.beginSet()).toBe(true);
    for (const t of frameTimes(1500, 4000)) n.feed(nativeEvent([member(repeatedSquats(t, 1500, 1, 1600, 0.95, 600))], t, 'ios'));
    const before = n.o.snapshot().setReps;
    expect(before).toBe(1);
    const acceptedBefore = n.gate.stats.accepted;
    for (const t of frameTimes(4000, 6000)) n.feed(nativeEvent([], t, 'ios'));
    expect(n.gate.stats.accepted - acceptedBefore).toBe(frameTimes(4000, 6000).length);
    const lost = n.o.snapshot();
    expect(lost.locked).toBe(false);
    expect(lost.setReps).toBe(before);
    expect(lost.guidance).toBe('Step back into view.');
    for (const t of frameTimes(6000, 8000)) n.feed(nativeEvent([member(0)], t, 'ios'));
    for (const t of frameTimes(8000, 12000)) n.feed(nativeEvent([member(repeatedSquats(t, 8000, 2, 1600, 0.95, 600))], t, 'ios'));
    expect(n.o.snapshot().locked).toBe(true);
    expect(n.o.snapshot().setReps).toBeGreaterThan(before);
  });

  it('dropped frames: 15 fps still counts every rep; a >250 ms hole mid-rep voids that rep (no rep across the gap)', () => {
    const count = (keep: (t: number) => boolean) => {
      const n = nativePath();
      const seen: boolean[] = [];
      standardSet(
        (poses, t) => {
          if (!keep(t)) return;
          n.feed(nativeEvent(poses, t, 'android'));
          seen.push(n.o.snapshot().fresh);
        },
        () => n.o.beginSet(),
      );
      return { reps: n.o.snapshot().setReps, sawStale: seen.includes(false) };
    };
    let k = 0;
    expect(count(() => k++ % 2 === 0).reps).toBe(3);
    // The second rep of the set is mid-descent around 7.5 s: drop 400 ms there.
    const holed = count((t) => t < 7300 || t > 7700);
    expect(holed.reps).toBe(2);
    expect(holed.sawStale).toBe(true);
  });

  it('duplicate and out-of-order native frames are dropped before the session, so they never void a rep', () => {
    const n = nativePath();
    standardSet(
      (poses, t) => {
        n.feed(nativeEvent(poses, t, 'ios'));
        if (t > 5000 && t % 100 < 34) {
          n.feed(nativeEvent(poses, t, 'ios')); // the same frame again
          n.feed(nativeEvent(poses, t - 20, 'ios')); // an older frame
        }
      },
      () => n.o.beginSet(),
    );
    expect(n.o.snapshot().setReps).toBe(3);
    expect(n.gate.stats.duplicate).toBeGreaterThan(10);
    expect(n.gate.stats.outOfOrder).toBeGreaterThan(10);
    // Fed straight to the session instead (no gate), one repeated frame mid-rep voids that rep.
    const w = webPath();
    standardSet(
      (poses, t) => {
        w.feed(poses, t);
        if (t === 6000) w.feed(poses, t);
      },
      () => w.o.beginSet(),
    );
    expect(w.o.snapshot().setReps).toBe(2);
  });

  it('orientation: an upright portrait stream reads head-above-feet and becomes ready; a sideways (un-rotated) stream never does', () => {
    const r = toPoseFrame(nativeEvent([member(0)], 0, 'ios'), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.frame.poses[0];
    expect(p.nose!.y).toBeLessThan(p.leftShoulder!.y);
    expect(p.leftShoulder!.y).toBeLessThan(p.leftHip!.y);
    expect(p.leftHip!.y).toBeLessThan(p.leftKnee!.y);
    expect(p.leftKnee!.y).toBeLessThan(p.leftAnkle!.y);

    const upright = nativePath();
    for (const t of frameTimes(0, 1500)) upright.feed(nativeEvent([member(0)], t, 'ios'));
    expect(upright.o.snapshot().readyForCountdown).toBe(true);

    // What a missing rotation would deliver: the body lying along x in a landscape frame.
    const sideways = (pose: Pose): Pose =>
      Object.fromEntries(Object.entries(pose).map(([k, l]) => [k, { x: 1 - l!.y, y: l!.x, visibility: l!.visibility }]));
    const turned = nativePath();
    for (const t of frameTimes(0, 3000)) turned.feed(nativeEvent([sideways(member(0))], t, 'ios', { width: 640, height: 480 }));
    for (const t of frameTimes(3000, 8000)) turned.feed(nativeEvent([sideways(member(repeatedSquats(t, 3000, 2, 1600, 0.95, 600)))], t, 'ios', { width: 640, height: 480 }));
    expect(turned.snaps.some((s) => s.readyForCountdown)).toBe(false);
    expect(turned.o.snapshot().setReps).toBe(0);
  });

  it('mirroring: the member raising their RIGHT hand appears at smaller x in the data (unmirrored)', () => {
    const raw = rawFromPose(member(0));
    // Member's right side is image-left in the unmirrored front-camera frame.
    raw[VISUAL_INDEX.rightWrist] = { x: 0.38, y: 0.1, visibility: 0.95 };
    const r = toPoseFrame(nativeEvent([], 0, 'android', { people: [flat(raw)] }), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vis = visualFor(r.frame.poses[0])!;
    expect(vis.rightWrist!.x).toBeLessThan(vis.leftWrist!.x);
    expect(vis.rightWrist!.y).toBeLessThan(r.frame.poses[0].nose!.y);
  });
});

// ── 3. The native controller ────────────────────────────────────────────────

function fakeAppState(initial = 'active') {
  const subs = new Set<(s: string) => void>();
  let removed = 0;
  const api = {
    currentState: initial as string | null,
    addEventListener: (_type: 'change', fn: (s: string) => void) => {
      subs.add(fn);
      return { remove: () => { if (subs.delete(fn)) removed += 1; } };
    },
    fire(s: string) {
      api.currentState = s;
      for (const fn of [...subs]) fn(s);
    },
    get listeners() { return subs.size; },
    get removed() { return removed; },
  };
  return api;
}

function fakeModule(answer: boolean | 'throw' = true) {
  const calls = { request: 0 };
  let release: ((v: { granted: boolean }) => void) | null = null;
  const mod: WsfPoseCameraNativeModule = {
    getCameraPermissionAsync: async () => ({ granted: answer === true }),
    requestCameraPermissionAsync: () => {
      calls.request += 1;
      if (answer === 'throw') return Promise.reject(new Error('denied by OS'));
      return Promise.resolve({ granted: answer === true, status: answer ? 'granted' : 'denied' });
    },
  };
  const deferred: WsfPoseCameraNativeModule = {
    getCameraPermissionAsync: async () => ({ granted: false }),
    requestCameraPermissionAsync: () => new Promise((resolve) => { release = resolve; }),
  };
  return { mod, deferred, calls, grant: () => release?.({ granted: true }) };
}

function controller(opts: { mod?: WsfPoseCameraNativeModule | null; appState?: ReturnType<typeof fakeAppState> } = {}) {
  const appState = opts.appState ?? fakeAppState();
  const ctl = new NativeController({
    nativeModule: opts.mod === undefined ? fakeModule().mod : opts.mod,
    appState: appState as unknown as AppStateLike,
  });
  const bindings: NativeCameraBinding[] = [];
  ctl.subscribeBinding((b) => bindings.push(b));
  return { ctl, appState, bindings };
}

const poseFor = (runId: number, poses: Pose[], t: number) => ({ ...nativeEvent(poses, t, 'android'), runId });

describe('controller.native — the same public API as controller.ts', () => {
  it('exposes the same public surface (and REQUESTED_CAMERA), plus the native binding seam', () => {
    for (const k of ['subscribe', 'startCamera', 'stopCamera', 'beginSet', 'finishSet', 'dispose']) {
      expect(typeof (WebController.prototype as unknown as Record<string, unknown>)[k], k).toBe('function');
      expect(typeof (NativeController.prototype as unknown as Record<string, unknown>)[k], k).toBe('function');
    }
    expect(Object.getOwnPropertyDescriptor(NativeController.prototype, 'snapshot')?.get).toBeTypeOf('function');
    expect(Object.getOwnPropertyDescriptor(WebController.prototype, 'snapshot')?.get).toBeTypeOf('function');
    expect(NATIVE_REQUESTED_CAMERA).toMatchObject({ facingMode: 'user', width: 640, height: 480 });
    const { ctl } = controller();
    expect(isNativeCameraHost(ctl)).toBe(true);
    expect(isNativeCameraHost(new WebController({ testHook: null, pauseOnHide: false }))).toBe(false);
    ctl.dispose();
  });

  it('tsc holds the native controller and preview to the surface the shared camera screen uses', () => {
    // tsc resolves CameraRepCounter's imports to the WEB files only, so these assignments are what
    // makes a drift in controller.native.ts / NativeCameraPreview.native.tsx a type error.
    const native = new NativeController({ nativeModule: null, pauseOnHide: false });
    const api: Pick<WebController, 'snapshot' | 'subscribe' | 'startCamera' | 'stopCamera' | 'beginSet' | 'finishSet' | 'dispose'> = native;
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const previewProps: Same<Parameters<typeof NativeCameraPreview>[0], Parameters<typeof WebNativeCameraPreview>[0]> = true;
    expect(typeof api.subscribe).toBe('function');
    expect(previewProps).toBe(true);
    native.dispose();
  });
});

describe('controller.native — one run, one owner; released on every way out', () => {
  it('full flow: permission → camera bound for run 1 → ready → stable → GO → 3 squats → Finish → released', async () => {
    const { ctl, appState, bindings } = controller();
    expect(bindings).toEqual([{ active: false, runId: 0 }]);
    const views: string[] = [];
    ctl.subscribe((s) => views.push(s.camera));
    await ctl.startCamera(null);
    expect(ctl.snapshot.camera).toBe('loadingModel');
    expect(bindings.at(-1)).toEqual({ active: true, runId: 1 });
    expect(views).toContain('starting');
    ctl.handlePose(poseFor(1, [member(0)], 0)); // before ready: ignored
    expect(ctl.frameStats.accepted).toBe(0);
    ctl.handleReady({ runId: 1, engine: 'mediapipe-tasks-vision@0.10.35 pose_landmarker_lite (GPU, numPoses=3) ios' });
    expect(ctl.snapshot.camera).toBe('live');
    for (const t of frameTimes(0, 1500)) ctl.handlePose(poseFor(1, [member(0)], t));
    expect(ctl.snapshot.readyForCountdown).toBe(true);
    expect(ctl.snapshot.visual?.leftWrist).toBeDefined();
    expect(ctl.beginSet()).toBe(true);
    for (const t of frameTimes(1500, 8500)) ctl.handlePose(poseFor(1, [member(repeatedSquats(t, 1500, 3, 1600, 0.95, 600))], t));
    expect(ctl.snapshot.setReps).toBe(3);
    expect(ctl.finishSet()).toEqual({ estimatedReps: 3, source: 'camera-estimate', verified: false });
    ctl.dispose();
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
    expect(appState.listeners).toBe(0);
    expect(appState.removed).toBe(1);
    // After dispose nothing reacts.
    ctl.handlePose(poseFor(1, [member(0)], 9000));
    await ctl.startCamera(null);
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
  });

  it('events from any other run are ignored (a late result releases only itself)', async () => {
    const { ctl, bindings } = controller();
    await ctl.startCamera(null);
    ctl.handleReady({ runId: 1, engine: 'x' });
    for (const t of frameTimes(0, 300)) ctl.handlePose(poseFor(1, [member(0)], t));
    const accepted = ctl.frameStats.accepted;
    ctl.stopCamera();
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
    expect(ctl.snapshot.camera).toBe('off');
    await ctl.startCamera(null);
    expect(bindings.at(-1)).toEqual({ active: true, runId: 2 });
    // Late events of run 1 arrive after run 2 began.
    ctl.handleReady({ runId: 1, engine: 'x' });
    ctl.handlePose(poseFor(1, [member(0)], 400));
    ctl.handleError({ runId: 1, stage: 'inference' });
    ctl.handleInterrupted({ runId: 1 });
    expect(ctl.snapshot.camera).toBe('loadingModel');
    expect(ctl.frameStats.accepted).toBe(0);
    ctl.handleReady({ runId: 2, engine: 'x' });
    expect(ctl.snapshot.camera).toBe('live');
    expect(accepted).toBeGreaterThan(0);
    ctl.dispose();
  });

  it('a permission answer that arrives after Stop opens nothing', async () => {
    const f = fakeModule();
    const { ctl, bindings } = controller({ mod: f.deferred });
    const started = ctl.startCamera(null);
    expect(ctl.snapshot.camera).toBe('starting');
    ctl.stopCamera();
    f.grant();
    await started;
    expect(ctl.snapshot.camera).toBe('off');
    expect(bindings.some((b) => b.active)).toBe(false);
    ctl.dispose();
  });

  it('permission denied or failing → the failure panel (manual entry); no module → unsupported', async () => {
    for (const answer of [false, 'throw'] as const) {
      const { ctl, bindings } = controller({ mod: fakeModule(answer).mod });
      await ctl.startCamera(null);
      expect(ctl.snapshot).toMatchObject({ camera: 'failed', failure: 'permission' });
      expect(bindings.some((b) => b.active)).toBe(false);
      ctl.dispose();
    }
    const { ctl } = controller({ mod: null });
    await ctl.startCamera(null);
    expect(ctl.snapshot).toMatchObject({ camera: 'failed', failure: 'unsupported' });
    ctl.dispose();
  });

  it('native errors map to the failure stages (native playback = "Camera isn\u2019t available", not the browser tap panel) and release the camera', async () => {
    for (const [stage, expected] of [['model', 'model'], ['inference', 'inference'], ['playback', 'ended'], ['ended', 'ended'], ['permission', 'permission'], ['weird', 'ended']] as const) {
      const { ctl, bindings } = controller();
      await ctl.startCamera(null);
      ctl.handleError({ runId: 1, stage: stage as 'model' });
      expect(ctl.snapshot).toMatchObject({ camera: 'failed', failure: expected });
      expect(bindings.at(-1)!.active).toBe(false);
      ctl.dispose();
    }
  });

  it('AppState leaving active pauses (banked reps kept) and releases; a native interruption does the same', async () => {
    const { ctl, appState, bindings } = controller();
    await ctl.startCamera(null);
    ctl.handleReady({ runId: 1, engine: 'x' });
    for (const t of frameTimes(0, 1500)) ctl.handlePose(poseFor(1, [member(0)], t));
    expect(ctl.beginSet()).toBe(true);
    for (const t of frameTimes(1500, 4000)) ctl.handlePose(poseFor(1, [member(repeatedSquats(t, 1500, 1, 1600, 0.95, 600))], t));
    expect(ctl.snapshot.setReps).toBe(1);
    appState.fire('active'); // no change
    expect(ctl.snapshot.camera).toBe('live');
    appState.fire('inactive'); // Control Center, a call, Siri
    expect(ctl.snapshot).toMatchObject({ camera: 'paused', setReps: 1, guidance: 'Camera paused.' });
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
    // Resume: a fresh run; readiness again; banked reps kept.
    appState.fire('active');
    await ctl.startCamera(null);
    expect(bindings.at(-1)).toEqual({ active: true, runId: 2 });
    ctl.handleReady({ runId: 2, engine: 'x' });
    expect(ctl.snapshot.setReps).toBe(1);
    ctl.handleInterrupted({ runId: 2, reason: 'detached' });
    expect(ctl.snapshot.camera).toBe('paused');
    expect(bindings.at(-1)).toEqual({ active: false, runId: 2 });
    ctl.dispose();
  });

  it('the OS permission prompt (iOS alert → inactive, Android dialog → background) does not pause the run being asked for', async () => {
    const f = fakeModule();
    const { ctl, appState, bindings } = controller({ mod: f.deferred });
    const started = ctl.startCamera(null);
    appState.fire('inactive');
    appState.fire('background');
    expect(ctl.snapshot.camera).toBe('starting');
    f.grant();
    await started;
    appState.fire('active');
    expect(ctl.snapshot.camera).toBe('loadingModel');
    expect(bindings.at(-1)).toEqual({ active: true, runId: 1 });
    // Once the camera is open, leaving the foreground pauses again.
    appState.fire('background');
    expect(ctl.snapshot.camera).toBe('paused');
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
    ctl.dispose();
  });

  it('a permission answer that lands while the app is away opens the camera only on the next "active"', async () => {
    const f = fakeModule();
    const { ctl, appState, bindings } = controller({ mod: f.deferred });
    const started = ctl.startCamera(null);
    appState.fire('background'); // e.g. Android: the dialog paused the activity; the answer arrives before onResume
    f.grant();
    await started;
    expect(ctl.snapshot.camera).toBe('loadingModel');
    expect(bindings.some((b) => b.active)).toBe(false);
    appState.fire('inactive'); // still away: nothing opens, nothing pauses
    expect(bindings.some((b) => b.active)).toBe(false);
    expect(ctl.snapshot.camera).toBe('loadingModel');
    appState.fire('active');
    expect(bindings.at(-1)).toEqual({ active: true, runId: 1 });
    ctl.dispose();
  });

  it('a throw while counting or rendering a frame fails the run closed (released, manual entry), as the web lifecycle does', async () => {
    const { ctl, bindings } = controller();
    await ctl.startCamera(null);
    ctl.handleReady({ runId: 1, engine: 'x' });
    let thrown = 0;
    ctl.subscribe((s) => {
      if (s.camera === 'live' && s.keypoints && thrown === 0) {
        thrown += 1;
        throw new Error('listener boom');
      }
    });
    expect(() => {
      for (const t of frameTimes(0, 300)) ctl.handlePose(poseFor(1, [member(0)], t));
    }).not.toThrow();
    expect(thrown).toBe(1);
    expect(ctl.snapshot).toMatchObject({ camera: 'failed', failure: 'inference' });
    expect(bindings.at(-1)).toEqual({ active: false, runId: 1 });
    ctl.dispose();
  });

  it('does not start while the app is in the background', async () => {
    const { ctl, bindings } = controller({ appState: fakeAppState('background') });
    await ctl.startCamera(null);
    expect(ctl.snapshot.camera).toBe('off');
    expect(bindings.some((b) => b.active)).toBe(false);
    ctl.dispose();
  });

  it('frameStats count the duplicates the gate dropped (dev HUD for the device proof)', async () => {
    const { ctl } = controller();
    await ctl.startCamera(null);
    ctl.handleReady({ runId: 1, engine: 'x' });
    for (const t of [0, 33, 33, 20, 66]) ctl.handlePose(poseFor(1, [member(0)], t));
    expect(ctl.frameStats).toEqual({ accepted: 3, invalid: 0, duplicate: 1, outOfOrder: 1 });
    ctl.dispose();
  });
});

// ── 4. Fail closed: support only with the linked module ─────────────────────

describe('support.native — fail closed: the telemetry gate, then the linked module', () => {
  const linked = fakeModule().mod;
  it('the telemetry approval constant is false, so native support is false even with the module linked', () => {
    expect(nativeSupport.NATIVE_CAMERA_TELEMETRY_APPROVED).toBe(false);
    expect(nativeSupport.nativeCameraCounterAllowed(nativeSupport.NATIVE_CAMERA_TELEMETRY_APPROVED, { os: 'ios', load: () => linked })).toBe(false);
    expect(nativeSupport.nativeCameraCounterAllowed(nativeSupport.NATIVE_CAMERA_TELEMETRY_APPROVED, { os: 'android', load: () => linked })).toBe(false);
    const req = vi.mocked(requireOptionalNativeModule);
    req.mockReturnValue(linked);
    try {
      expect(nativeSupport.cameraCounterSupported()).toBe(false);
    } finally {
      req.mockReturnValue(null);
    }
    // With support false, a squat "Start moving" never opens the camera: members get the manual flow.
    const entry = { settings: DEFAULT_MOVE_CAMERA_SETTINGS, unit: 'squats', mode: 'start' as const, resumed: false };
    expect(cameraEntryAllowed({ ...entry, supported: nativeSupport.cameraCounterSupported() })).toBe(false);
    expect(cameraEntryAllowed({ ...entry, supported: true })).toBe(true);
  });

  it('once approved, support still needs the linked module on iOS/Android (both gate states covered)', () => {
    expect(nativeSupport.nativeCameraCounterAllowed(true, { os: 'ios', load: () => linked })).toBe(true);
    expect(nativeSupport.nativeCameraCounterAllowed(true, { os: 'android', load: () => linked })).toBe(true);
    expect(nativeSupport.nativeCameraCounterAllowed(true, { os: 'ios', load: () => null })).toBe(false);
    expect(nativeSupport.nativeCameraCounterAllowed(true, { os: 'web', load: () => linked })).toBe(false);
    expect(nativeSupport.nativeCameraCounterAllowed(false, { os: 'ios', load: () => linked })).toBe(false);
  });

  it('the gate states its reason and points at the review and the owner decision', () => {
    const code = read('src/movement-camera/support.native.ts');
    expect(code).toMatch(/export const NATIVE_CAMERA_TELEMETRY_APPROVED: boolean = false;/);
    for (const need of ['#638', 'ClearcutLoggingClient', 'com.google.android.datatransport', 'No camera frames, images or landmarks', "owner's"]) {
      expect(code, need).toContain(need);
    }
    expect(code).toMatch(/return nativeCameraCounterAllowed\(NATIVE_CAMERA_TELEMETRY_APPROVED\);/);
  });

  it('iOS/Android with the module → true; without it (Expo Go, an older binary) → false; web → false', () => {
    expect(nativeSupport.nativePoseCameraLinked({ os: 'ios', load: () => linked })).toBe(true);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'android', load: () => linked })).toBe(true);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'ios', load: () => null })).toBe(false);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'android', load: () => { throw new Error('boom'); } })).toBe(false);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'ios', load: () => ({}) as WsfPoseCameraNativeModule })).toBe(false);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'web', load: () => linked })).toBe(false);
  });

  it('the default probe asks requireOptionalNativeModule for WsfPoseCamera and fails closed when it is absent', () => {
    const req = vi.mocked(requireOptionalNativeModule);
    req.mockClear();
    req.mockReturnValueOnce(null);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'android' })).toBe(false);
    expect(req).toHaveBeenCalledWith(WSF_POSE_CAMERA_MODULE);
    req.mockReturnValueOnce(linked);
    expect(nativeSupport.nativePoseCameraLinked({ os: 'ios' })).toBe(true);
    req.mockImplementationOnce(() => { throw new Error('not installed'); });
    expect(loadWsfPoseCameraModule()).toBeNull();
    // Under test the runtime is web (react-native-web) and the module is absent.
    expect(nativeSupport.cameraCounterSupported()).toBe(false);
  });

  it('the synthetic web test source never exists on native', () => {
    expect(nativeSupport.testPoseHook('1', { location: { hostname: '127.0.0.1' } })).toBeNull();
    expect(nativeSupport.pageTestPoseHook()).toBeNull();
  });

  it('stays tiny: it never statically reaches the camera screen, controller, frozen counter, engine or visual mapping', () => {
    const code = read('src/movement-camera/support.native.ts');
    expect(code).not.toMatch(/^import (?!type).*'\.\/(controller|orchestrator|engine|frozen|visual|nativeEngine)/m);
    expect(code).toMatch(/requestCameraPermissionAsync === 'function'/);
  });
});

// ── 5. Overlay and preview slot ─────────────────────────────────────────────

describe('CameraSkeletonOverlay.native — react-native-svg body guide', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('draws both arms, torso, legs and a head RING with the web geometry; mirrored for display only', () => {
    const r = toPoseFrame(nativeEvent([member(0)], 0, 'ios'), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const subject = r.frame.poses[0];
    const visual = visualFor(subject);
    const aspect = r.frame.aspect!;
    act(() => root.render(createElement(CameraSkeletonOverlay, { subject, visual, aspect })));
    const wrap = container.querySelector('[data-testid="wsf-camera-figure"]') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(getComputedStyle(wrap).transform).toBe('scaleX(-1)');
    expect(getComputedStyle(wrap).pointerEvents).toBe('none');
    const svg = wrap.querySelector('svg')!;
    const g = figureGeometry(subject, visual, aspect);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${g.width} ${g.height}`);
    expect(g.width).toBe(750);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    const layers = svg.querySelectorAll('g');
    expect(layers).toHaveLength(2);
    expect(layers[0].getAttribute('stroke-width') ?? layers[0].getAttribute('strokeWidth')).toBe('22');
    expect(layers[1].getAttribute('stroke-width') ?? layers[1].getAttribute('strokeWidth')).toBe('11');
    for (const layer of Array.from(layers)) {
      expect(layer.querySelectorAll('path')).toHaveLength(8);
      const circles = layer.querySelectorAll('circle');
      expect(circles).toHaveLength(1);
      expect(layer.getAttribute('fill')).toBe('none'); // a ring, not a dot
      const rr = Number(circles[0].getAttribute('r'));
      expect(rr).toBeGreaterThanOrEqual(26);
      expect(rr).toBeLessThanOrEqual(150);
    }
    // Arms: shoulder → elbow → wrist, drawn at the UNMIRRORED data x (the mirror is the transform).
    const ds = Array.from(layers[1].querySelectorAll('path')).map((p) => p.getAttribute('d')!);
    const pt = (x: number, y: number) => `${(x * g.width).toFixed(1)} ${(y * g.height).toFixed(1)}`;
    const le = visual!.leftElbow!;
    const lw = visual!.leftWrist!;
    const ls = subject.leftShoulder!;
    expect(ds).toContain(`M${pt(ls.x, ls.y)} L${pt(le.x, le.y)} L${pt(lw.x, lw.y)}`);
    const re = visual!.rightElbow!;
    expect(ds.some((d) => d.includes(pt(re.x, re.y)))).toBe(true);
  });
});

describe('NativeCameraPreview.native — the preview slot bound to the controller', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fakeView.props.length = 0;
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the native view only while the binding is active, for that run, and routes its events to the controller', async () => {
    const { ctl } = controller();
    act(() => root.render(createElement(NativeCameraPreview, { controller: ctl })));
    expect(vi.mocked(requireNativeView)).toHaveBeenCalledWith(WSF_POSE_CAMERA_MODULE);
    const node = () => container.querySelector('[data-testid="wsf-camera-native-preview"]')!;
    expect(node().getAttribute('data-active')).toBe('false');
    await act(async () => { await ctl.startCamera(null); });
    expect(node().getAttribute('data-active')).toBe('true');
    expect(node().getAttribute('data-run')).toBe('1');
    const props = fakeView.props.at(-1)!;
    expect(props.pointerEvents).toBe('none');
    act(() => (props.onCameraReady as (e: unknown) => void)({ nativeEvent: { runId: 1, engine: 'x' } }));
    expect(ctl.snapshot.camera).toBe('live');
    act(() => (fakeView.props.at(-1)!.onPose as (e: unknown) => void)({ nativeEvent: poseFor(1, [member(0)], 0) }));
    expect(ctl.frameStats.accepted).toBe(1);
    act(() => (fakeView.props.at(-1)!.onCameraInterrupted as (e: unknown) => void)({ nativeEvent: { runId: 1 } }));
    expect(ctl.snapshot.camera).toBe('paused');
    expect(node().getAttribute('data-active')).toBe('false');
    act(() => ctl.dispose());
    expect(node().getAttribute('data-active')).toBe('false');
  });

  it('renders nothing for a controller without the native seam (fail closed)', () => {
    act(() => root.render(createElement(NativeCameraPreview, { controller: {} })));
    expect(container.innerHTML).toBe('');
  });

  it('the camera screen puts the preview in the native slot and keeps the web <video> unchanged', () => {
    const code = read('src/ui/CameraRepCounter.tsx');
    expect(code).toMatch(/Platform\.OS === 'web'\s*\? createElement\('video', \{/);
    expect(code).toMatch(/: <NativeCameraPreview controller=\{ctl\} \/>\}/);
    expect(read('src/ui/NativeCameraPreview.tsx')).toMatch(/return null;/);
  });
});

// ── 6. The bundled model ────────────────────────────────────────────────────

describe('the bundled model is the web model, byte for byte', () => {
  const PINNED_SHA256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
  /** md5 of the GCS object at MODEL_URL (x-goog-hash / ETag 04a75ddf…), matched when it was downloaded. */
  const GCS_MD5 = '04a75ddf7c811ac7a1a4523266dd7d88';
  const bytes = readFileSync(nodePath.join(APP, MOD, 'assets', MODEL_FILE));

  it('sha256 is pinned, and the module, Swift and Kotlin all carry the same pin', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PINNED_SHA256);
    expect(MODEL_SHA256).toBe(PINNED_SHA256);
    expect(read(`${MOD}/ios/WsfPoseModel.swift`)).toContain(`static let sha256 = "${PINNED_SHA256}"`);
    expect(read(`${MOD}/android/src/main/java/expo/modules/wsfposecamera/WsfPoseContract.kt`)).toContain(`const val MODEL_SHA256 = "${PINNED_SHA256}"`);
  });

  it('it is the object web downloads (lite float16 v1): same file name, size and GCS md5; a MediaPipe task bundle', () => {
    expect(MODEL_URL.endsWith(`/pose_landmarker_lite/float16/1/${MODEL_FILE}`)).toBe(true);
    expect(bytes.length).toBe(5_777_746);
    expect(createHash('md5').update(bytes).digest('hex')).toBe(GCS_MD5);
    expect(bytes.indexOf(Buffer.from('504b0304', 'hex'))).toBe(2); // zip local header (after a 2-byte prefix)
    expect(bytes.includes(Buffer.from('pose_detector.tflite'))).toBe(true);
    expect(bytes.includes(Buffer.from('pose_landmarks_detector.tflite'))).toBe(true);
  });

  it('is wired into the iOS resource bundle and the Android assets (one copy, no download)', () => {
    const podspec = read(`${MOD}/WsfPoseCamera.podspec`);
    expect(podspec).toMatch(/s\.resource_bundles = \{\s*'WsfPoseCameraModel' => \['assets\/pose_landmarker_lite\.task'\]\s*\}/);
    expect(read(`${MOD}/ios/WsfPoseModel.swift`)).toMatch(/resourceBundle = "WsfPoseCameraModel"/);
    const gradle = read(`${MOD}/android/build.gradle`);
    expect(gradle).toMatch(/assets\.srcDirs \+= \['\.\.\/assets'\]/);
    expect(existsSync(nodePath.join(APP, MOD, 'android', '..', 'assets', MODEL_FILE))).toBe(true);
    expect(filesUnder(MOD).filter((f) => f.endsWith('.task'))).toEqual([`${MOD}/assets/${MODEL_FILE}`]);
  });
});

// ── 7. The uncompiled native code, held to the contract statically ──────────

describe('native sources: header, settings, wiring and versions (static; the code is UNCOMPILED here)', () => {
  const HEADER = 'UNCOMPILED in sprint sandbox — first compile happens in an EAS development build';
  const swift = (f: string) => read(`${MOD}/ios/${f}`);
  const kt = (f: string) => read(`${MOD}/android/src/main/java/expo/modules/wsfposecamera/${f}`);
  const nativeFiles = filesUnder(MOD).filter((f) => /\.(swift|kt|podspec|gradle|pro)$/.test(f));
  const contract = () => kt('WsfPoseContract.kt');

  it('every native file starts with the UNCOMPILED header', () => {
    expect(nativeFiles.length).toBe(13);
    for (const f of nativeFiles) {
      const first = read(f).split('\n')[0];
      expect(first, f).toMatch(/^(\/\/|#) /);
      expect(first.slice(first.indexOf(' ') + 1), f).toBe(HEADER);
    }
  });

  it('expo-module.config.json names the real classes and the root podspec', () => {
    const cfg = JSON.parse(read(`${MOD}/expo-module.config.json`));
    expect(cfg.platforms).toEqual(['apple', 'android']);
    expect(cfg.apple.modules).toEqual(['WsfPoseCameraModule']);
    expect(existsSync(nodePath.join(APP, MOD, cfg.apple.podspecPath))).toBe(true);
    expect(swift('WsfPoseCameraModule.swift')).toMatch(/public class WsfPoseCameraModule: Module/);
    expect(cfg.android.modules).toEqual(['expo.modules.wsfposecamera.WsfPoseCameraModule']);
    expect(kt('WsfPoseCameraModule.kt')).toMatch(/^package expo\.modules\.wsfposecamera$/m);
    expect(kt('WsfPoseCameraModule.kt')).toMatch(/class WsfPoseCameraModule : Module\(\)/);
  });

  it('both sides register the JS name, the two props and the four events the preview listens to', () => {
    const events = ['onCameraReady', 'onPose', 'onCameraError', 'onCameraInterrupted'];
    const ev = `Events(${events.map((e) => `"${e}"`).join(', ')})`;
    for (const code of [swift('WsfPoseCameraModule.swift'), kt('WsfPoseCameraModule.kt')]) {
      expect(code).toContain(`Name("${WSF_POSE_CAMERA_MODULE}")`);
      expect(code).toContain(ev);
      expect(code).toContain('Prop("active")');
      expect(code).toContain('Prop("runId")');
      expect(code).toContain('OnViewDidUpdateProps');
      expect(code).toContain('AsyncFunction("requestCameraPermissionAsync")');
      expect(code).toContain('AsyncFunction("getCameraPermissionAsync")');
    }
    const preview = read('src/ui/NativeCameraPreview.native.tsx');
    for (const e of events) expect(preview).toContain(`${e}={(e) => host.`);
    expect(kt('WsfPoseCameraModule.kt')).toContain('OnViewDestroys');
  });

  it('the web engine settings, on both platforms: lite model, VIDEO, numPoses 3, 0.5 x3, no masks, GPU then CPU', () => {
    const s = swift('WsfPoseModel.swift');
    for (const need of ['static let maxPoses = 3', 'static let minConfidence: Float = 0.5', 'options.runningMode = .video', 'options.numPoses = maxPoses',
      'options.minPoseDetectionConfidence = minConfidence', 'options.minPosePresenceConfidence = minConfidence', 'options.minTrackingConfidence = minConfidence',
      'options.shouldOutputSegmentationMasks = false', 'return (try make(.GPU), engine("GPU"))', 'return (try make(.CPU), engine("CPU"))',
      'fileName = "pose_landmarker_lite"', 'guard digest == sha256']) expect(s, need).toContain(need);
    const k = kt('WsfPoseModel.kt');
    for (const need of ['.setRunningMode(RunningMode.VIDEO)', '.setNumPoses(WsfPoseContract.MAX_POSES)',
      '.setMinPoseDetectionConfidence(WsfPoseContract.MIN_CONFIDENCE)', '.setMinPosePresenceConfidence(WsfPoseContract.MIN_CONFIDENCE)',
      '.setMinTrackingConfidence(WsfPoseContract.MIN_CONFIDENCE)', '.setOutputSegmentationMasks(false)',
      'Loaded(make(Delegate.GPU), WsfPoseContract.engine("GPU"))', 'Loaded(make(Delegate.CPU), WsfPoseContract.engine("CPU"))',
      'WsfPoseContract.verifiedModelBuffer(context.assets.open(WsfPoseContract.MODEL_FILE)', '.setModelAssetBuffer(model)']) expect(k, need).toContain(need);
    for (const need of ['const val MAX_POSES = 3', 'const val MIN_CONFIDENCE = 0.5f', `const val MODEL_FILE = "${MODEL_FILE}"`,
      'check(sha256Hex(bytes) == MODEL_SHA256)']) expect(contract(), need).toContain(need);
    expect(NATIVE_MAX_POSES).toBe(3);
  });

  it('the camera contract: front camera, upright, unmirrored data, drop-before-inference, ms (iOS) / ns (Android)', () => {
    const run = swift('WsfPoseRun.swift');
    for (const need of ['position: .front', 'kCVPixelFormatType_32BGRA', 'alwaysDiscardsLateVideoFrames = true', 'connection.isVideoMirrored = false',
      'connection.videoRotationAngle = 90', 'connection.videoOrientation = .portrait', '"timestampUnit": "ms"', '"mirrored": false',
      'MPImage(sampleBuffer: sampleBuffer, orientation: .up)']) expect(run, need).toContain(need);
    expect(run.indexOf('guard timestampMs > lastTimestampMs else { return }')).toBeGreaterThan(0);
    expect(run.indexOf('guard timestampMs > lastTimestampMs else { return }')).toBeLessThan(run.indexOf('landmarker.detect(videoFrame:'));
    expect(swift('WsfPoseCameraView.swift')).toContain('previewLayer.videoGravity = .resizeAspectFill');

    const krun = kt('WsfPoseRun.kt');
    for (const need of ['CameraSelector.DEFAULT_FRONT_CAMERA', 'ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST', 'ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888',
      'AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY', 'postRotate(rotation.toFloat())',
      'send("onPose", WsfPoseContract.posePayload(timestampNs, width, height, people))', 'image.close()']) expect(krun, need).toContain(need);
    for (const need of ['const val TIMESTAMP_UNIT = "ns"', '"timestampUnit" to TIMESTAMP_UNIT', '"timestamp" to timestampNs.toDouble()',
      'const val MIRRORED = false', '"mirrored" to MIRRORED', 'fun nsToMs(timestampNs: Long): Long = timestampNs / 1_000_000L',
      'if (ms <= lastMs) return null', 'persons.take(MAX_POSES)']) expect(contract(), need).toContain(need);
    expect(krun).not.toMatch(/postScale\(\s*-1/); // never mirrored
    expect(krun.indexOf('val timestampMs = clock.accept(timestampNs) ?: return')).toBeGreaterThan(0);
    expect(krun.indexOf('val timestampMs = clock.accept(timestampNs) ?: return')).toBeLessThan(krun.indexOf('detectForVideo('));
    // The pure contract stays Android-free (it is compiled and run on a plain JVM).
    expect(contract().match(/^import .+$/gm)).toEqual(['import java.nio.ByteBuffer', 'import java.nio.ByteOrder', 'import java.security.MessageDigest']);
    expect(kt('WsfPoseCameraView.kt')).toContain('PreviewView.ScaleType.FILL_CENTER');
  });

  it('review fixes for #638 are in place (fail-closed catches, frames freed, camera state, run ids, Recents/snapshot, R8, one session queue, preset order, SDK constants)', () => {
    const krun = kt('WsfPoseRun.kt');
    expect(krun.match(/catch \(error: Exception\)/g)).toEqual(['catch (error: Exception)']); // only the unbind cleanup
    expect(krun.match(/catch \(error: Throwable\)/g)?.length).toBe(4); // bind, loadModel, detectForVideo, analyze
    for (const need of ['mpImage.close()', 'if (rotated !== bitmap) bitmap.recycle()', 'observeCameraState(camera.cameraInfo.cameraState)',
      'cameraState?.removeObserver(observer)', 'CameraState.ERROR_CAMERA_IN_USE', 'CameraState.ErrorType.CRITICAL']) expect(krun, need).toContain(need);
    expect(kt('WsfPoseModel.kt')).toContain('} catch (gpuError: Throwable) {');
    const kview = kt('WsfPoseCameraView.kt');
    for (const need of ['startedRunId = wanted', 'WsfPoseContract.runChange(run?.runId ?: 0, startedRunId, active, runId)',
      'override fun onWindowFocusChanged', 'setRecentsScreenshotEnabled(enabled)', 'Build.VERSION_CODES.TIRAMISU']) expect(kview, need).toContain(need);
    expect(read(`${MOD}/android/proguard-rules.pro`)).toContain('-keep class com.google.common.flogger.** { *; }');
    const run = swift('WsfPoseRun.swift');
    expect(run).toContain('private static let sessionQueue = DispatchQueue(');
    expect(run).not.toMatch(/\n\s*private let sessionQueue/);
    expect(run.match(/WsfPoseRun\.sessionQueue\.async/g)?.length).toBe(2);
    expect(run.indexOf('session.addInput(input)')).toBeLessThan(run.indexOf('session.sessionPreset = .vga640x480'));
    for (const need of ['AVCaptureSession.wasInterruptedNotification', 'AVCaptureSession.runtimeErrorNotification',
      '= AVCaptureSessionInterruptionReasonKey', '= AVCaptureSessionErrorKey']) expect(run, need).toContain(need);
    expect(run).not.toMatch(/Notification\.Name\("/);
    const view = swift('WsfPoseCameraView.swift');
    for (const need of ['UIApplication.willResignActiveNotification', 'UIApplication.didBecomeActiveNotification', 'previewLayer.isHidden = hidden',
      'CATransaction.setDisableActions(true)', 'if wanted == startedRunId { return }', 'nonisolated(unsafe) private var run: WsfPoseRun?']) expect(view, need).toContain(need);
  });

  it('MediaPipe versions: iOS = web 0.10.35; Android pinned to the nearest confirmed 0.10.x and kept in step; never 1.x', () => {
    expect(MEDIAPIPE_VERSION).toBe('0.10.35');
    expect(read(`${MOD}/WsfPoseCamera.podspec`)).toContain(`s.dependency 'MediaPipeTasksVision', '${MEDIAPIPE_VERSION}'`);
    expect(swift('WsfPoseModel.swift')).toContain(`static let mediapipeVersion = "${MEDIAPIPE_VERSION}"`);
    const gradleVersion = read(`${MOD}/android/build.gradle`).match(/def mediapipeTasksVisionVersion = '([^']+)'/)![1];
    expect(gradleVersion).toBe('0.10.29');
    expect(gradleVersion).toMatch(/^0\.10\.\d+$/);
    expect(kt('WsfPoseContract.kt')).toContain(`const val MEDIAPIPE_VERSION = "${gradleVersion}"`);
    expect(read(`${MOD}/android/build.gradle`)).toContain('UNVERIFIED');
  });

  it('dependencies are exactly ExpoModulesCore + MediaPipe (iOS) and MediaPipe + CameraX core/camera2/lifecycle/view (Android)', () => {
    const deps = read(`${MOD}/WsfPoseCamera.podspec`).match(/s\.dependency [^\n]+/g);
    expect(deps).toEqual(["s.dependency 'ExpoModulesCore'", "s.dependency 'MediaPipeTasksVision', '0.10.35'"]);
    const impl = read(`${MOD}/android/build.gradle`).match(/^\s*implementation [^\n]+/gm)!.map((l) => l.trim());
    expect(impl).toEqual([
      'implementation "com.google.mediapipe:tasks-vision:${mediapipeTasksVisionVersion}"',
      'implementation "androidx.camera:camera-core:${cameraxVersion}"',
      'implementation "androidx.camera:camera-camera2:${cameraxVersion}"',
      'implementation "androidx.camera:camera-lifecycle:${cameraxVersion}"',
      'implementation "androidx.camera:camera-view:${cameraxVersion}"',
    ]);
  });
});

// ── 8. Privacy ──────────────────────────────────────────────────────────────

describe('privacy: the module records, stores and sends nothing itself; the SDK usage telemetry is disclosed and gated off; no audio, no location', () => {
  const NATIVE_FORBIDDEN = new RegExp(
    [
      // recording, capture and encoding
      'AVCapturePhotoOutput', 'AVCaptureMovieFileOutput', 'AVCaptureAudio', 'AVAudio', 'AVAssetWriter', 'AVAssetExportSession',
      'ImageCapture', 'VideoCapture', 'Recorder', 'AudioRecord', 'RECORD_AUDIO', 'MediaMuxer', 'MediaCodec', 'VTCompressionSession',
      'CGImageDestination', 'jpegData', 'pngData', 'JPEGRepresentation', '\\.compress\\(',
      // photo library and storage
      'PHPhotoLibrary', 'PHAsset', 'UIImageWriteToSavedPhotosAlbum', 'UISaveVideoAtPath', 'MediaStore', 'ContentResolver',
      'FileOutputStream', 'FileWriter', 'RandomAccessFile', 'openFileOutput', 'FileHandle', 'FileManager', 'write\\(to:', '\\.write\\(',
      'writeBytes', 'writeText', 'outputStream\\(', 'createFile', 'cacheDir', 'filesDir', 'ExternalStorage', 'UserDefaults',
      'SharedPreferences', 'NSKeyedArchiver',
      // network
      'URLSession', 'URLRequest', 'NSURLConnection', 'HttpURLConnection', 'OkHttp', 'NWConnection', 'Socket', 'openConnection',
      'openStream', 'URL\\(string:', 'fetch\\s*\\(', 'https?:\\/\\/',
      // audio and location
      '\\.audio\\b', 'microphone', 'CLLocation', 'CoreLocation', 'LocationManager', 'FusedLocation', '_LOCATION\\b',
    ].join('|'),
    'i',
  );
  /** Fully-qualified uses that skip an import. */
  const FQN_FORBIDDEN = /\b(java\.(io|net|nio\.file)|android\.(location|media)|okhttp3|retrofit2|io\.ktor)\./;
  const MODULE_FILES = [
    'WsfPoseCamera.podspec',
    'android/build.gradle',
    'android/proguard-rules.pro',
    'android/src/main/java/expo/modules/wsfposecamera/WsfPoseCameraModule.kt',
    'android/src/main/java/expo/modules/wsfposecamera/WsfPoseCameraView.kt',
    'android/src/main/java/expo/modules/wsfposecamera/WsfPoseContract.kt',
    'android/src/main/java/expo/modules/wsfposecamera/WsfPoseModel.kt',
    'android/src/main/java/expo/modules/wsfposecamera/WsfPoseRun.kt',
    'android/src/test/java/expo/modules/wsfposecamera/WsfPoseContractTest.kt',
    'assets/pose_landmarker_lite.task',
    'expo-module.config.json',
    'index.ts',
    'ios/WsfPoseCameraModule.swift',
    'ios/WsfPoseCameraView.swift',
    'ios/WsfPoseModel.swift',
    'ios/WsfPoseRun.swift',
    'src/WsfPoseCamera.types.ts',
    'src/WsfPoseCameraView.tsx',
  ].map((f) => `${MOD}/${f}`);

  it('the module holds exactly the reviewed files: no .m/.mm/.h/.java, no AndroidManifest.xml, nothing unscanned', () => {
    expect(filesUnder(MOD).sort()).toEqual([...MODULE_FILES].sort());
    expect(existsSync(nodePath.join(APP, MOD, 'android/src/main/AndroidManifest.xml'))).toBe(false);
    // What the builds compile: the podspec glob and the gradle source set (default src/main/java).
    expect(read(`${MOD}/WsfPoseCamera.podspec`)).toContain("s.source_files = 'ios/**/*.{h,m,mm,swift}'");
    expect(read(`${MOD}/android/build.gradle`)).not.toMatch(/java\.srcDirs|kotlin\.srcDirs|manifest\.srcFile/);
  });

  it('static scan of every compiled source kind (Swift, Kotlin, Java, ObjC, TS); comments removed, strings kept; JVM test sources are not shipped', () => {
    const code = filesUnder(MOD).filter((f) => /\.(swift|kt|java|m|mm|h|ts|tsx)$/.test(f) && !f.includes('/android/src/test/'));
    expect(code.length).toBe(12);
    for (const f of code) {
      const c = strip(read(f));
      expect(c, f).not.toMatch(NATIVE_FORBIDDEN);
      expect(c, f).not.toMatch(FQN_FORBIDDEN);
    }
    // A '//' inside a string no longer hides the rest of the line from the scan.
    expect(strip('let s = "a//b"; let x = AVCaptureMovieFileOutput()')).toMatch(NATIVE_FORBIDDEN);
    expect(strip('// AVCaptureMovieFileOutput in a comment')).not.toMatch(NATIVE_FORBIDDEN);
  });

  it('imports are pinned: Swift only the reviewed frameworks; Kotlin exactly the reviewed set', () => {
    const swiftImports = new Set(
      filesUnder(MOD).filter((f) => f.endsWith('.swift')).flatMap((f) => (strip(read(f)).match(/^import \w+/gm) ?? []).map((l) => l.slice(7))),
    );
    expect([...swiftImports].sort()).toEqual(['AVFoundation', 'CoreMedia', 'CoreVideo', 'CryptoKit', 'ExpoModulesCore', 'Foundation', 'MediaPipeTasksVision', 'UIKit']);
    const ktImports = [
      ...new Set(filesUnder(MOD).filter((f) => f.endsWith('.kt') && !f.includes('/src/test/')).flatMap((f) => (read(f).match(/^import [\w.]+/gm) ?? []).map((l) => l.slice(7)))),
    ].sort();
    expect(ktImports).toEqual([
      'android.Manifest',
      'android.content.Context',
      'android.content.pm.PackageManager',
      'android.graphics.Bitmap',
      'android.graphics.Color',
      'android.graphics.Matrix',
      'android.os.Build',
      'android.os.Handler',
      'android.os.Looper',
      'android.util.Size',
      'android.view.View',
      'android.view.ViewGroup',
      'androidx.camera.core.CameraSelector',
      'androidx.camera.core.CameraState',
      'androidx.camera.core.ImageAnalysis',
      'androidx.camera.core.ImageProxy',
      'androidx.camera.core.Preview',
      'androidx.camera.core.UseCase',
      'androidx.camera.core.resolutionselector.AspectRatioStrategy',
      'androidx.camera.core.resolutionselector.ResolutionSelector',
      'androidx.camera.core.resolutionselector.ResolutionStrategy',
      'androidx.camera.lifecycle.ProcessCameraProvider',
      'androidx.camera.view.PreviewView',
      'androidx.lifecycle.LifecycleOwner',
      'androidx.lifecycle.LiveData',
      'androidx.lifecycle.Observer',
      'com.google.mediapipe.framework.image.BitmapImageBuilder',
      'com.google.mediapipe.tasks.components.containers.NormalizedLandmark',
      'com.google.mediapipe.tasks.core.BaseOptions',
      'com.google.mediapipe.tasks.core.Delegate',
      'com.google.mediapipe.tasks.vision.core.RunningMode',
      'com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker',
      'expo.modules.interfaces.permissions.Permissions',
      'expo.modules.kotlin.AppContext',
      'expo.modules.kotlin.Promise',
      'expo.modules.kotlin.modules.Module',
      'expo.modules.kotlin.modules.ModuleDefinition',
      'expo.modules.kotlin.viewevent.EventDispatcher',
      'expo.modules.kotlin.views.ExpoView',
      'java.nio.ByteBuffer',
      'java.nio.ByteOrder',
      'java.security.MessageDigest',
      'java.util.concurrent.Executor',
      'java.util.concurrent.ExecutorService',
      'java.util.concurrent.Executors',
    ]);
  });

  it('the MediaPipe SDK usage telemetry is disclosed wherever the module speaks about privacy; datatransport is NOT excluded', () => {
    const types = read(`${MOD}/src/WsfPoseCamera.types.ts`);
    for (const need of ['SDK USAGE TELEMETRY', 'Clearcut (play.googleapis.com/log)', 'com.google.android.datatransport',
      'No camera frames, images or landmarks', 'NATIVE_CAMERA_TELEMETRY_APPROVED = false']) expect(types, need).toContain(need);
    expect(types).not.toMatch(/no\s+\*?\s*network, no audio/);
    const podspec = read(`${MOD}/WsfPoseCamera.podspec`);
    expect(podspec).toContain('Its MediaPipeTasksCommon dependency sends Google usage telemetry');
    expect(podspec).toContain('ClearcutLoggingClient');
    expect(podspec).not.toContain('Nothing is recorded, stored or uploaded');
    const gradle = read(`${MOD}/android/build.gradle`);
    for (const need of ['com.google.android.datatransport', 'ACCESS_NETWORK_STATE', 'RemoteLoggingClient', 'no frames, images or landmarks']) expect(gradle, need).toContain(need);
    expect(gradle).not.toMatch(/Never 1\.x without/);
    // Excluding the uploader would crash: RemoteLoggingClient throws NoClassDefFoundError.
    const gradleCode = strip(gradle); // the warning comment itself names the forbidden line
    expect(gradleCode).not.toMatch(/datatransport/);
    expect(gradleCode).not.toMatch(/\bexclude\b/);
  });

  it('the only inputs are the front camera (video) and the bundled model; permission is CAMERA / video only', () => {
    const run = strip(read(`${MOD}/ios/WsfPoseRun.swift`));
    expect(run.match(/AVCaptureDeviceInput\(/g)).toHaveLength(1);
    expect(run.match(/addOutput\(/g)).toHaveLength(1);
    expect(run).toContain('AVCaptureVideoDataOutput()');
    const mod = strip(read(`${MOD}/ios/WsfPoseCameraModule.swift`));
    expect(mod.match(/for: \.video/g)?.length).toBe(3);
    const kmod = strip(read(`${MOD}/android/src/main/java/expo/modules/wsfposecamera/WsfPoseCameraModule.kt`));
    expect(kmod.match(/Manifest\.permission\.[A-Z_]+/g)).toEqual(['Manifest.permission.CAMERA', 'Manifest.permission.CAMERA']);
    const krun = strip(read(`${MOD}/android/src/main/java/expo/modules/wsfposecamera/WsfPoseRun.kt`));
    expect(krun).toMatch(/bindToLifecycle\(owner, selector, preview, analysis\)/);
    // The model is read from the app's own assets / bundle, never fetched.
    expect(strip(read(`${MOD}/android/src/main/java/expo/modules/wsfposecamera/WsfPoseModel.kt`))).toMatch(/context\.assets\.open\(WsfPoseContract\.MODEL_FILE\)/);
  });

  it('the app config blocks the microphone and explains the camera honestly (owned by NATIVE-BUILD-1; checked by meaning, not wording)', () => {
    const app = JSON.parse(read('app.json')).expo;
    // Android: the camera is requested, the microphone is blocked, nothing asks for audio.
    expect(app.android.permissions).toContain('android.permission.CAMERA');
    expect(app.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
    expect(app.android.permissions.filter((p: string) => /RECORD_AUDIO|MICROPHONE|CAPTURE_AUDIO/i.test(p))).toEqual([]);
    // iOS: no microphone purpose string anywhere in the app config.
    expect(app.ios.infoPlist.NSMicrophoneUsageDescription).toBeUndefined();
    expect(read('app.json') + read('app.config.js')).not.toMatch(/NSMicrophoneUsageDescription/);
    // The camera purpose string says what the camera is for (counting, on this device) and that
    // nothing is kept or sent: its "recorded" sentence is a negation that covers upload too.
    const why: string = app.ios.infoPlist.NSCameraUsageDescription;
    expect(why).toMatch(/\bcamera\b/i);
    expect(why).toMatch(/\bcount/i);
    expect(why).toMatch(/\bon (this|your) device\b/i);
    const kept = why.split(/(?<=\.)\s+/).find((s) => /\brecorded\b/i.test(s));
    expect(kept, 'a sentence about recording').toBeDefined();
    expect(kept!).toMatch(/^(Nothing|No)\b/);
    expect(kept!).toMatch(/\buploaded\b/i);
  });

  it('the new app files carry no recording, readback, network, storage or Firestore', () => {
    const files = [
      'src/movement-camera/nativeEngine.ts',
      'src/movement-camera/controller.native.ts',
      'src/movement-camera/support.native.ts',
      'src/ui/CameraSkeletonOverlay.native.tsx',
      'src/ui/NativeCameraPreview.tsx',
      'src/ui/NativeCameraPreview.native.tsx',
    ];
    for (const f of files) {
      expect(strip(read(f)), f).not.toMatch(/MediaRecorder|captureStream|toDataURL|toBlob|getImageData|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|AsyncStorage|httpsCallable|firebase|firestore|odml\.pa\.googleapis|contributionFlow|pendingContribution/i);
    }
  });

  it('the web bundle never reaches the native module: only .native files import it at runtime', () => {
    const appFiles = [...filesUnder('src'), ...filesUnder('app')].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('/frozen/'));
    const importers = appFiles.filter((f) => read(f).includes('modules/wsf-pose-camera'));
    expect(importers.sort()).toEqual([
      'src/movement-camera/controller.native.ts',
      'src/movement-camera/nativeEngine.ts',
      'src/movement-camera/support.native.ts',
      'src/ui/NativeCameraPreview.native.tsx',
    ]);
    for (const f of importers.filter((x) => !x.includes('.native.'))) {
      for (const line of strip(read(f)).split('\n').filter((l) => l.includes('modules/wsf-pose-camera'))) {
        expect(line, f).toMatch(/^} from|^import type/);
      }
      expect(read(f), f).toMatch(/^import type \{[^}]*\} from '\.\.\/\.\.\/modules\/wsf-pose-camera\/src\/WsfPoseCamera\.types';/m);
    }
  });
});
