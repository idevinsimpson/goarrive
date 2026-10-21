import { Platform } from 'react-native';

import { WSF_BUILD_STAMP } from './buildStamp';
import { deviceKv, type DeviceKv } from './storage/kv';

/**
 * The part of the device store the crash records use. Narrower than DeviceKv
 * on purpose, so a store (or a test fake) needs only these three and the
 * crash modules compile whatever else DeviceKv grows (#641 SH-4: the state
 * lane adds a required `readItem`).
 */
export type CrashKv = Pick<DeviceKv, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE CRASH RECORD: WHAT IS KEPT, AND WHAT NEVER IS.
 *
 * Written by the native global-handler wrapper (src/crashContainment.native.ts)
 * and by the route boundaries' fallback (src/ui/RouteErrorFallback.native.tsx);
 * read by Build details (src/ui/CrashRecordsCard.native.tsx). Nothing on web
 * writes or reads it.
 *
 * WHAT A RECORD NEVER CARRIES. No email address, display name, goal title,
 * community name, join code or URL. The message is scrubbed (`scrubMessage`:
 * URLs, email addresses, quoted text that is not a dotted code path, any token
 * containing a digit, and any 16+ character token, a join code's minimum
 * length) and then kept only if it has the shape of a known engine, React or
 * harness message (`recordMessage`); any other message is withheld. A message
 * React builds from app data ("Objects are not valid as a React child (found:
 * object with keys {…})") keeps only its fixed opening words. Stack frames
 * keep only a function name and a file basename with line and column.
 *
 * BOUNDED WORK. The record is built synchronously while a fatal error waits
 * to be passed on, so no input can make it slow: the message and the stack are
 * cut to a fixed length BEFORE any pattern runs, and every pattern is linear
 * (bounded quantifiers, one pass per token).
 */

export const CRASH_RECORDS_KEY = 'wsfdiag.crashes.v1';
/** How many records are kept, newest first. */
export const MAX_CRASH_RECORDS = 5;
const MAX_MESSAGE = 160;
const MAX_FRAMES = 8;
/** What of a raw message is looked at at all; cut before any pattern runs. */
export const MAX_SCRUB_INPUT = 1000;
/** What of a raw stack is looked at, and the longest line read as a frame. */
const MAX_STACK_INPUT = 4000;
const MAX_FRAME_LINE = 400;

export type CrashKind = 'fatal' | 'error' | 'rejection' | 'boundary';

export type CrashRecord = {
  v: 1;
  at: string;
  kind: CrashKind;
  /** The error's class name, or `NonError` for a thrown non-Error. */
  name: string;
  message: string;
  frames: string[];
  platform: string;
  build: string;
};

const CODE_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** The message, with anything that could identify a person or a community removed. */
export function scrubMessage(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  // Cut first: nothing below ever sees more than MAX_SCRUB_INPUT characters.
  let s = raw
    .slice(0, MAX_SCRUB_INPUT)
    // A scheme is short; bounding it keeps a long dotted run linear.
    .replace(/\b[a-z][a-z0-9+.-]{0,31}:\/\/\S+/gi, '<url>')
    // RFC 5321 limits: a 64-character local part, 63-character labels. An
    // address past them loses its tail here, and what is left must still
    // have a safe shape to be kept at all (recordMessage).
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, '<email>')
    // Quoted text: kept only when it is a dotted code path ('window.location.origin').
    .replace(/(["'`‘’“”])([^"'`‘’“”\n]{0,200})(["'`‘’“”])/g, (m, _o, inner: string) =>
      CODE_PATH.test(inner) ? m : '<text>',
    )
    // One pass per token: any token with a digit, and any 16+ character token.
    .replace(/[A-Za-z0-9_-]+/g, (t) => (t.length >= 16 || /\d/.test(t) ? '<id>' : t))
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MAX_MESSAGE) s = `${s.slice(0, MAX_MESSAGE - 1)}…`;
  return s;
}

/*
  WHICH MESSAGES ARE KEPT AT ALL. Scrubbing tokens cannot catch a name written
  without quotes ("rejected for Alex Rivera"), so a message is kept only when,
  after scrubbing, it has the shape of an engine, React or harness message
  whose variable parts are single code tokens. Everything else is withheld.
*/
const V = String.raw`(?:<text>|<id>|'[A-Za-z_$][\w$.]*'|[A-Za-z_$][\w$.]*)`;
const SAFE_MESSAGES: RegExp[] = [
  new RegExp(String.raw`^Cannot read propert(?:y|ies) ${V} of (?:undefined|null)$`),
  new RegExp(String.raw`^Cannot read properties of (?:undefined|null) \(reading ${V}\)$`),
  new RegExp(
    String.raw`^${V} is not (?:a function|an object|a constructor|iterable)(?: \((?:evaluating|near) ${V}\))?$`,
  ),
  new RegExp(String.raw`^Property ${V} doesn't exist$`),
  new RegExp(String.raw`^Can't find variable: ${V}$`),
  new RegExp(String.raw`^${V} is not defined$`),
  /^Maximum call stack size exceeded\.?$/,
  /^Text strings must be rendered within a <Text> component\.?$/,
];
/*
  Messages React builds around app data or long fixed prose: only the fixed
  opening words are kept, never the rest. "Objects are not valid as a React
  child" goes on to quote `Object.keys(child)`, which can be a display name or
  a goal title (#641 CS-1).
*/
const PREFIX_MESSAGES: string[] = [
  'Objects are not valid as a React child',
  'Maximum update depth exceeded',
  'Rendered more hooks than',
  'Rendered fewer hooks than',
];
/*
  Fixed-vocabulary messages, kept as they are before the long-token rule would
  blank them: a Firebase error code (auth/network-request-failed) and the
  test harness's own faults (src/crashHarness.ts).
*/
const RAW_SAFE_MESSAGES: RegExp[] = [
  /^Firebase: Error \((?:app|auth|firestore|functions|storage)\/[a-z][a-z-]{0,60}\)\.?$/,
  /^WSF injected (?:render fault: [a-z][a-z-]{0,40}(?: \(read [a-z]+\))?|timer fault|rejection)$/,
];
export const WITHHELD_MESSAGE = '<withheld>';

/** The scrubbed message when it has a known safe shape; otherwise `<withheld>`. */
export function recordMessage(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  // Each RAW_SAFE pattern is anchored and bounded, so this is constant work.
  if (raw.length <= 120 && RAW_SAFE_MESSAGES.some((re) => re.test(raw))) return raw;
  const prefix = PREFIX_MESSAGES.find((p) => raw.startsWith(p));
  if (prefix) return `${prefix}…`;
  const s = scrubMessage(raw);
  if (!s) return '';
  return SAFE_MESSAGES.some((re) => re.test(s)) ? s : WITHHELD_MESSAGE;
}

function safeName(e: unknown): string {
  if (!(e instanceof Error)) return 'NonError';
  const n = typeof e.name === 'string' ? e.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(n) ? n : 'Error';
}

/** `fn@file:line:col` for each frame, with directories, hosts and queries dropped. */
export function scrubFrames(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  const out: string[] = [];
  for (const rawLine of stack.slice(0, MAX_STACK_INPUT).split('\n')) {
    const line = rawLine.trim();
    // A real frame is short; a longer line (a message carried into the stack) is skipped unread.
    if (line.length > MAX_FRAME_LINE) continue;
    let fn: string;
    let loc: string;
    let m = /^at (.+?) \((.+)\)$/.exec(line);
    if (m) {
      fn = m[1]!;
      loc = m[2]!;
    } else if ((m = /^at (.+)$/.exec(line))) {
      fn = '?';
      loc = m[1]!;
    } else if ((m = /^([^@\s]*)@(.+)$/.exec(line))) {
      fn = m[1] || '?';
      loc = m[2]!;
    } else {
      continue;
    }
    const pos = /:(\d+):(\d+)$/.exec(loc);
    let file = pos ? loc.slice(0, pos.index) : loc;
    file = file.replace(/^address at /, '').split('?')[0]!.split('#')[0]!;
    file = file.slice(file.lastIndexOf('/') + 1) || '?';
    if (!/^[\w.$<>-]{1,80}$/.test(file)) file = '?';
    if (!/^[\w$.<>]{1,60}$/.test(fn)) fn = '?';
    out.push(`${fn}@${file}${pos ? `:${pos[1]}:${pos[2]}` : ''}`);
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}

export function crashRecordOf(error: unknown, kind: CrashKind, now: Date = new Date()): CrashRecord {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return {
    v: 1,
    at: now.toISOString(),
    kind,
    name: safeName(error),
    message: recordMessage(message),
    frames: error instanceof Error ? scrubFrames(error.stack) : [],
    platform: Platform.OS,
    build: WSF_BUILD_STAMP.commitSha,
  };
}

function isRecord(r: unknown): r is CrashRecord {
  return typeof r === 'object' && r !== null && (r as CrashRecord).v === 1 && typeof (r as CrashRecord).at === 'string';
}

/** The records kept on this device, newest first. Never throws. */
export async function readCrashRecords(kv: CrashKv = deviceKv): Promise<CrashRecord[]> {
  try {
    const raw = await kv.getItem(CRASH_RECORDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, MAX_CRASH_RECORDS) : [];
  } catch {
    return [];
  }
}

export async function clearCrashRecords(kv: CrashKv = deviceKv): Promise<boolean> {
  return kv.removeItem(CRASH_RECORDS_KEY);
}

/*
  Writes to one store are serialized, so two records landing together never
  drop one. A write waits for the one before it for at most WRITE_WAIT_MS: a
  store that hangs once must not hold every later record back forever.
*/
const WRITE_WAIT_MS = 2000;
const writeChains = new WeakMap<CrashKv, Promise<unknown>>();

function settledOrTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

/** Prepends a record (keeping the newest few). Resolves false on any failure; never throws. */
export function persistCrash(record: CrashRecord, kv: CrashKv = deviceKv): Promise<boolean> {
  const previous = writeChains.get(kv);
  const ready = previous ? settledOrTimeout(previous, WRITE_WAIT_MS) : Promise.resolve();
  const write = ready.then(async () => {
    try {
      const existing = await readCrashRecords(kv);
      return await kv.setItem(CRASH_RECORDS_KEY, JSON.stringify([record, ...existing].slice(0, MAX_CRASH_RECORDS)));
    } catch {
      return false;
    }
  });
  writeChains.set(kv, write);
  return write;
}

/** A render error a route boundary caught (not fatal: the fallback is on screen). */
export function noteCaughtError(error: unknown, kv: CrashKv = deviceKv): Promise<boolean> {
  try {
    return persistCrash(crashRecordOf(error, 'boundary'), kv);
  } catch {
    return Promise.resolve(false);
  }
}
