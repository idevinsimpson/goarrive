import { Platform } from 'react-native';

import { WSF_BUILD_STAMP } from './buildStamp';
import { deviceKv, type DeviceKv } from './storage/kv';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE APP'S LAST LINE: RECORD, THEN LET THE
 * PLATFORM DO WHAT IT ALWAYS DID.
 *
 * Render errors are contained by the route `ErrorBoundary` exports
 * (src/ui/RouteErrorFallback.tsx). What reaches React Native's global handler
 * is everything else: a throw in a timer or an event callback, which RN treats
 * as fatal and which ends the process in a release build. Nothing can make
 * that survivable from here, and swallowing it would leave the app running in
 * an unknown state. So this module does exactly two things:
 *
 *   1. It wraps `ErrorUtils.getGlobalHandler()`: a scrubbed record of the
 *      error is written to the device, and THEN the previous handler runs with
 *      the same arguments. A fatal error is never swallowed. Because the
 *      previous handler ends the process, the write is given a bounded moment
 *      (`PERSIST_GRACE_MS`) to land first; a write that hangs never holds the
 *      error back for longer.
 *   2. In a release build it turns on Hermes' rejection tracking, which React
 *      Native enables only in development, so an unhandled promise rejection
 *      is recorded instead of vanishing. It is recorded, not escalated: it was
 *      never fatal and does not become fatal here.
 *
 * The record is surfaced on the next launch in Build details (`app/health.tsx`).
 * Adopting a crash reporter is an owner decision; this keeps what one would
 * need and sends nothing anywhere.
 *
 * WHAT A RECORD NEVER CARRIES. No email address, display name, goal title,
 * community name, join code or URL. The message is scrubbed (`scrubMessage`:
 * URLs, email addresses, quoted text that is not a dotted code path, any token
 * containing a digit, and any 16+ character token, a join code's minimum
 * length) and then kept only if it has the shape of a known engine, React or
 * harness message (`recordMessage`); any other message is withheld. Stack
 * frames keep only a function name and a file basename with line and column.
 *
 * WEB IS UNCHANGED. react-native-web has no `ErrorUtils`, and nothing is
 * installed there: a web crash still behaves as it always has.
 *
 * Imported first by `app/_layout.tsx`, so it installs before any other module
 * of the app runs.
 */

export const CRASH_RECORDS_KEY = 'wsfdiag.crashes.v1';
/** How many records are kept, newest first. */
export const MAX_CRASH_RECORDS = 5;
/** The longest a fatal error waits for its record to be written. */
export const PERSIST_GRACE_MS = 1500;
const MAX_MESSAGE = 160;
const MAX_FRAMES = 8;

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
  let s = raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>')
    // Quoted text: kept only when it is a dotted code path ('window.location.origin').
    .replace(/(["'`‘’“”])([^"'`‘’“”\n]{0,200})(["'`‘’“”])/g, (m, _o, inner: string) =>
      CODE_PATH.test(inner) ? m : '<text>',
    )
    .replace(/[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*/g, '<id>')
    .replace(/[A-Za-z0-9_-]{16,}/g, '<id>')
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
  /^Maximum update depth exceeded\./,
  /^Rendered (?:more|fewer) hooks than /,
  /^Text strings must be rendered within a <Text> component\.?$/,
  /^Objects are not valid as a React child/,
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
  if (typeof raw === 'string' && RAW_SAFE_MESSAGES.some((re) => re.test(raw))) return raw;
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
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
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
export async function readCrashRecords(kv: DeviceKv = deviceKv): Promise<CrashRecord[]> {
  try {
    const raw = await kv.getItem(CRASH_RECORDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, MAX_CRASH_RECORDS) : [];
  } catch {
    return [];
  }
}

export async function clearCrashRecords(kv: DeviceKv = deviceKv): Promise<boolean> {
  return kv.removeItem(CRASH_RECORDS_KEY);
}

/*
  Writes to one store are serialized, so two records landing together never
  drop one. A write waits for the one before it for at most WRITE_WAIT_MS: a
  store that hangs once must not hold every later record back forever.
*/
const WRITE_WAIT_MS = 2000;
const writeChains = new WeakMap<DeviceKv, Promise<unknown>>();

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
export function persistCrash(record: CrashRecord, kv: DeviceKv = deviceKv): Promise<boolean> {
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
export function noteCaughtError(error: unknown, kv: DeviceKv = deviceKv): Promise<boolean> {
  try {
    return persistCrash(crashRecordOf(error, 'boundary'), kv);
  } catch {
    return Promise.resolve(false);
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler(): GlobalHandler | undefined;
  setGlobalHandler(handler: GlobalHandler): void;
};
type HermesLike = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};
type GlobalLike = { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };

export type InstallOptions = {
  globalObject?: GlobalLike;
  platform?: string;
  /** A development build: RN already tracks rejections there (LogBox). */
  dev?: boolean;
  kv?: DeviceKv;
  graceMs?: number;
  /** Tests only: install again over a previous install. */
  force?: boolean;
};

let installed = false;

/**
 * Installs the wrapper once. Returns whether it installed. A no-op on web and
 * wherever `ErrorUtils` is missing.
 */
export function installCrashContainment(options: InstallOptions = {}): boolean {
  const platform = options.platform ?? Platform.OS;
  if (platform === 'web') return false;
  if (installed && !options.force) return false;
  const g = options.globalObject ?? (globalThis as unknown as GlobalLike);
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.getGlobalHandler !== 'function' || typeof eu.setGlobalHandler !== 'function') return false;
  const kv = options.kv ?? deviceKv;
  const graceMs = options.graceMs ?? PERSIST_GRACE_MS;
  const dev = options.dev ?? (typeof __DEV__ !== 'undefined' ? __DEV__ : false);
  const previous = eu.getGlobalHandler();

  let handling = false;
  const handler: GlobalHandler = (error, isFatal) => {
    if (handling) {
      // A second error while the first is still being written: pass it on at
      // once rather than recursing into the recorder.
      previous?.(error, isFatal);
      return;
    }
    let record: CrashRecord | null = null;
    try {
      record = crashRecordOf(error, isFatal ? 'fatal' : 'error');
    } catch {
      record = null;
    }
    if (!record) {
      previous?.(error, isFatal);
      return;
    }
    if (!isFatal) {
      void persistCrash(record, kv);
      previous?.(error, isFatal);
      return;
    }
    handling = true;
    let passed = false;
    const pass = () => {
      if (passed) return;
      passed = true;
      handling = false;
      previous?.(error, isFatal);
    };
    const timer = setTimeout(pass, graceMs);
    persistCrash(record, kv).then(
      () => {
        clearTimeout(timer);
        pass();
      },
      () => {
        clearTimeout(timer);
        pass();
      },
    );
  };
  eu.setGlobalHandler(handler);

  if (!dev) {
    try {
      g.HermesInternal?.enablePromiseRejectionTracker?.({
        allRejections: true,
        onUnhandled: (_id, rejection) => {
          try {
            void persistCrash(crashRecordOf(rejection, 'rejection'), kv);
          } catch {
            // Recording must never become an error of its own.
          }
        },
        onHandled: () => undefined,
      });
    } catch {
      // A runtime without the tracker keeps its own behaviour.
    }
  }
  installed = true;
  return true;
}

// Imported first by app/_layout.tsx: install on evaluation.
installCrashContainment();
