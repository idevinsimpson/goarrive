/**
 * NATIVE-CAMERA-1 CONTRACT EVIDENCE — the Kotlin emitter and the JS adapter agree.
 *
 * One recorded-format landmark stream (tests/fixtures/native-camera/landmark-stream.json: camera
 * ns timestamps, upright frame size and MediaPipe's 33 [x, y, visibility|null] per person, as
 * float32 values) goes two ways:
 *
 *  (K) through the REAL Kotlin code that WsfPoseRun.analyze runs after MediaPipe returns —
 *      WsfFrameClock.accept, WsfPoseContract.people / posePayload, + runId — compiled and run on
 *      the JVM by docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh, which writes
 *      tests/fixtures/native-camera/android-emitted.json; those events then go through the JS
 *      adapter (nativeEngine.ts NativeFrameGate → toPoseFrame);
 *  (R) through a JS reference written from the contract alone: keep a frame only if its whole ms
 *      is after the last kept one, at most 3 people, a missing visibility is "not reported", and
 *      map each person with the web engine's mapPerson.
 *
 * The test asserts the Kotlin events equal the contract's events exactly, that (K) and (R)
 * produce identical PoseFrames, and that both drive the REAL frozen session to identical
 * snapshots. The stream is SYNTHETIC (a deterministic stick figure in the recorded format), not
 * a camera recording: this proves the two adapters agree, not that anything counts on a body.
 *
 * The Kotlin output also records the sha256 of WsfPoseContract.kt and WsfPoseContractTest.kt, and
 * this suite checks them against the files in the tree: any edit to the Kotlin contract fails here
 * until the JVM run is repeated, so the snapshot cannot go stale silently.
 *
 * Regenerate: WSF_WRITE_NATIVE_FIXTURES=1 npx vitest run tests/move-camera-native-contract.test.ts
 * then docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh --update.
 */
import { describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { NATIVE_MAX_POSES, NativeFrameGate } from '../src/movement-camera/nativeEngine';
import { RepCounterOrchestrator, type RepCounterSnapshot } from '../src/movement-camera/orchestrator';
import { repeatedSquats, syntheticPose, type SyntheticPerson } from '../src/movement-camera/synthetic';
import type { Keypoint, Pose, PoseFrame } from '../src/movement-camera/types';
import { BLAZEPOSE_INDEX, mapPerson, VISUAL_INDEX, visualFor, type RawLandmark } from '../src/movement-camera/visual';

const APP = nodePath.resolve(__dirname, '..');
const FIXTURES = nodePath.join(APP, 'tests/fixtures/native-camera');
const INPUT = nodePath.join(FIXTURES, 'landmark-stream.json');
const KOTLIN = nodePath.join(FIXTURES, 'android-emitted.json');
const KOTLIN_SOURCES = {
  'WsfPoseContract.kt': 'modules/wsf-pose-camera/android/src/main/java/expo/modules/wsfposecamera/WsfPoseContract.kt',
  'WsfPoseContractTest.kt': 'modules/wsf-pose-camera/android/src/test/java/expo/modules/wsfposecamera/WsfPoseContractTest.kt',
} as const;

type RecordedLandmark = [number, number, number | null];
interface RecordedFrame {
  timestampNs: number;
  width: number;
  height: number;
  persons: RecordedLandmark[][];
}

// ── The recorded-format stream (deterministic) ──────────────────────────────

const BOOT_MS = 3 * 24 * 3600 * 1000;
/** Multiples of 1/1024 are exact float32 values with short decimals, like MediaPipe's floats. */
const f32 = (v: number) => Math.fround(Math.round(v * 1024) / 1024);
const MEMBER: SyntheticPerson = { cx: 0.5, footY: 0.92, height: 0.7, depth: 0 };

function recordPerson(p: Pose, opts: { noEarVisibility?: boolean; noRightAnkleVisibility?: boolean } = {}): RecordedLandmark[] {
  const raw: RecordedLandmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, f32(0.05)]);
  for (const [k, i] of Object.entries(BLAZEPOSE_INDEX) as [Keypoint, number][]) {
    const lm = p[k];
    raw[i] = lm ? [f32(lm.x), f32(lm.y), f32(lm.visibility)] : [0.5, 0.5, 0];
  }
  const { nose, leftShoulder: ls, rightShoulder: rs, leftHip: lh, rightHip: rh } = p;
  if (nose) {
    const v = opts.noEarVisibility ? null : f32(0.9);
    raw[VISUAL_INDEX.leftEar] = [f32(nose.x + 0.03), f32(nose.y), v];
    raw[VISUAL_INDEX.rightEar] = [f32(nose.x - 0.03), f32(nose.y), v];
  }
  if (ls && lh) {
    raw[VISUAL_INDEX.leftElbow] = [f32(ls.x + 0.04), f32((ls.y + lh.y) / 2), f32(0.9)];
    raw[VISUAL_INDEX.leftWrist] = [f32(lh.x + 0.05), f32(lh.y), f32(0.9)];
  }
  if (rs && rh) {
    raw[VISUAL_INDEX.rightElbow] = [f32(rs.x - 0.04), f32((rs.y + rh.y) / 2), f32(0.9)];
    raw[VISUAL_INDEX.rightWrist] = [f32(rh.x - 0.05), f32(rh.y), f32(0.9)];
  }
  if (opts.noRightAnkleVisibility) raw[BLAZEPOSE_INDEX.rightAnkle][2] = null;
  return raw;
}

/** GO is at the first frame at or after this time. */
const GO_MS = 1500;

function generateStream(): { frames: RecordedFrame[]; injected: number[] } {
  const frames: RecordedFrame[] = [];
  const injected: number[] = [];
  const push = (f: RecordedFrame, inject = false) => {
    if (inject) injected.push(frames.length);
    frames.push(f);
  };
  for (let k = 0; ; k += 1) {
    const t = Math.round((k * 1000) / 30);
    if (t >= 10500) break;
    // Sub-millisecond detail, as a ns camera clock has.
    const ns = (BOOT_MS + t) * 1e6 + ((k * 7919) % 1_000_000);
    let persons: RecordedLandmark[][];
    if (t < GO_MS) persons = [recordPerson(syntheticPose(MEMBER), { noEarVisibility: k % 5 === 0 })];
    else if (t < 8500) {
      const depth = repeatedSquats(t, GO_MS, 3, 1600, 0.95, 600);
      persons = [recordPerson(syntheticPose({ ...MEMBER, depth }), { noRightAnkleVisibility: t > 4000 && t < 4300 })];
    } else if (t < 9300) persons = []; // the member walked out
    else {
      // The member is back, with three people far behind: MediaPipe reports at most numPoses.
      persons = [
        recordPerson(syntheticPose(MEMBER)),
        ...[0.15, 0.32, 0.85].map((cx) => recordPerson(syntheticPose({ cx, footY: 0.7, height: 0.35, depth: 0 }))),
      ];
    }
    const frame: RecordedFrame = { timestampNs: ns, width: 480, height: 640, persons };
    push(frame);
    if (k % 41 === 7) push({ ...frame }, true); // the same frame delivered twice
    if (k % 53 === 11) push({ ...frame, timestampNs: (BOOT_MS + t) * 1e6 + 999_999 }, true); // same ms, later ns
    if (k % 67 === 13) push({ ...frame, timestampNs: ns - 20e6 }, true); // an older frame
  }
  return { frames, injected };
}

function streamFileText(frames: RecordedFrame[]): string {
  const about =
    'SYNTHETIC landmark stream in the recorded native format (not a camera recording). Generated by tests/move-camera-native-contract.test.ts.';
  return `{"about":${JSON.stringify(about)},"frames":[\n${frames.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

// ── The contract, written down in JS (the reference R) ──────────────────────

interface EmittedEvent {
  runId: number;
  timestamp: number;
  timestampUnit: string;
  width: number;
  height: number;
  mirrored: boolean;
  people: number[][];
}

/** What the Android side must send for this stream, by the contract alone. */
function contractEvents(frames: RecordedFrame[]): { events: EmittedEvent[]; dropped: number[] } {
  let lastMs: bigint | null = null;
  const events: EmittedEvent[] = [];
  const dropped: number[] = [];
  frames.forEach((f, i) => {
    const ms = BigInt(f.timestampNs) / 1_000_000n;
    if (lastMs !== null && ms <= lastMs) {
      dropped.push(i);
      return;
    }
    lastMs = ms;
    events.push({
      runId: 1,
      timestamp: f.timestampNs,
      timestampUnit: 'ns',
      width: f.width,
      height: f.height,
      mirrored: false,
      people: f.persons.slice(0, NATIVE_MAX_POSES).map((p) => p.flatMap(([x, y, v]) => [Math.fround(x), Math.fround(y), v === null ? -1 : Math.fround(v)])),
    });
  });
  return { events, dropped };
}

/** The web engine's normalisation of the same kept frames (engine.ts: mapPerson per person, aspect = w / h). */
function referenceFrames(frames: RecordedFrame[], dropped: number[]): PoseFrame[] {
  const skip = new Set(dropped);
  return frames
    .filter((_, i) => !skip.has(i))
    .map((f) => ({
      timestampMs: f.timestampNs / 1e6,
      poses: f.persons.slice(0, NATIVE_MAX_POSES).map((p) =>
        mapPerson(
          p.map(([x, y, v]): RawLandmark => (v === null ? { x: Math.fround(x), y: Math.fround(y) } : { x: Math.fround(x), y: Math.fround(y), visibility: Math.fround(v) })),
        ),
      ),
      aspect: f.width / f.height,
    }));
}

function drive(frames: PoseFrame[]): { snaps: RepCounterSnapshot[]; go: boolean; finalSet: number } {
  const o = new RepCounterOrchestrator();
  o.beginRun();
  o.setCamera('live');
  const snaps: RepCounterSnapshot[] = [];
  let go = false;
  let began = false;
  for (const f of frames) {
    if (!began && f.timestampMs >= BOOT_MS + GO_MS) {
      began = true;
      go = o.beginSet();
    }
    snaps.push(o.onFrame(f));
  }
  return { snaps, go, finalSet: o.snapshot().setReps };
}

// ── The tests ───────────────────────────────────────────────────────────────

const generated = generateStream();
if (process.env.WSF_WRITE_NATIVE_FIXTURES === '1') writeFileSync(INPUT, streamFileText(generated.frames));
const inputText = readFileSync(INPUT, 'utf8');
const input = JSON.parse(inputText) as { frames: RecordedFrame[] };
interface KotlinOutput {
  generator: string;
  inputSha256: string;
  contractSources: Record<keyof typeof KOTLIN_SOURCES, string>;
  mediapipe: string;
  dropped: number[];
  events: EmittedEvent[];
}
let kotlinCache: KotlinOutput | null = null;
/** The JVM run's output (docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh). */
const kotlinOutput = (): KotlinOutput => (kotlinCache ??= JSON.parse(readFileSync(KOTLIN, 'utf8')) as KotlinOutput);

describe('the recorded-format stream', () => {
  it('is exactly what the deterministic generator produces (no hand edits)', () => {
    expect(inputText).toBe(streamFileText(generated.frames));
  });

  it('exercises every case: repeated, same-ms and older frames; missing visibility; nobody; four people', () => {
    const f = input.frames;
    expect(generated.injected.length).toBeGreaterThanOrEqual(15);
    expect(f.some((x) => x.persons.length === 0)).toBe(true);
    expect(f.some((x) => x.persons.length === 4)).toBe(true);
    expect(f.some((x) => x.persons.some((p) => p.some((l) => l[2] === null)))).toBe(true);
    for (const x of f) for (const p of x.persons) for (const l of p) for (const v of l) if (v !== null) expect(Math.fround(v)).toBe(v);
  });
});

describe('Kotlin (JVM-run WsfPoseContract) and the JS adapter agree', () => {
  it('the Kotlin events were produced from THIS stream by the JVM run', () => {
    expect(kotlinOutput().inputSha256).toBe(createHash('sha256').update(inputText).digest('hex'));
    expect(kotlinOutput().generator).toMatch(/WsfFrameClock\.accept \+ WsfPoseContract\.people\/posePayload \+ runId/);
    expect(kotlinOutput().mediapipe).toBe('0.10.29');
  });

  it('the Kotlin events were produced by THESE Kotlin sources (an edit to the contract needs a new JVM run)', () => {
    const now = Object.fromEntries(
      Object.entries(KOTLIN_SOURCES).map(([name, rel]) => [name, createHash('sha256').update(readFileSync(nodePath.join(APP, rel))).digest('hex')]),
    );
    expect(
      kotlinOutput().contractSources,
      'WsfPoseContract.kt or WsfPoseContractTest.kt changed: run docs/westayfit/qa/camera-evidence/run-kotlin-jvm.sh --update',
    ).toEqual(now);
  });

  it('Kotlin sends exactly the contract: same kept frames, same dropped frames, same payloads', () => {
    const want = contractEvents(input.frames);
    expect(kotlinOutput().dropped).toEqual(want.dropped);
    expect(kotlinOutput().dropped).toEqual(generated.injected);
    expect(kotlinOutput().events).toHaveLength(want.events.length);
    expect(kotlinOutput().events).toEqual(want.events);
    expect(kotlinOutput().events.every((e) => e.people.length <= 3)).toBe(true);
  });

  it('Kotlin events → JS adapter give the same normalised PoseFrames as the web mapping of the stream', () => {
    const gate = new NativeFrameGate();
    const viaKotlin: PoseFrame[] = [];
    for (const e of kotlinOutput().events) {
      const r = gate.accept(e);
      expect(r.ok).toBe(true);
      if (r.ok) viaKotlin.push(r.frame);
    }
    expect(gate.stats).toEqual({ accepted: kotlinOutput().events.length, invalid: 0, duplicate: 0, outOfOrder: 0 });
    const ref = referenceFrames(input.frames, kotlinOutput().dropped);
    expect(viaKotlin).toEqual(ref);
    for (let i = 0; i < ref.length; i += 1) {
      for (let p = 0; p < ref[i].poses.length; p += 1) expect(visualFor(viaKotlin[i].poses[p])).toEqual(visualFor(ref[i].poses[p]));
    }
    // Every landmark that reaches the counter carries a numeric visibility; a missing one is 0.
    for (const f of viaKotlin) for (const pose of f.poses) for (const l of Object.values(pose)) expect(typeof l!.visibility).toBe('number');
  });

  it('both drive the REAL frozen session to identical snapshots (GO at 1.5 s, then 3 squats → set 3)', () => {
    const gate = new NativeFrameGate();
    const viaKotlin = kotlinOutput().events.map((e) => gate.accept(e)).flatMap((r) => (r.ok ? [r.frame] : []));
    const k = drive(viaKotlin);
    const r = drive(referenceFrames(input.frames, kotlinOutput().dropped));
    expect(k.snaps).toEqual(r.snaps);
    expect(k.go).toBe(true);
    expect(k.finalSet).toBe(3);
    // The walk-out was seen as loss (not a gap), and the four-person frames reached the lock as three.
    expect(k.snaps.some((s) => !s.locked)).toBe(true);
  });
});
