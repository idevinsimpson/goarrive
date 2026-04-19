/**
 * voiceAuditLog — In-memory ring buffer of [VOICE-AUDIT] events.
 *
 * Wraps console.info/warn/error so any log line whose first argument starts
 * with `[VOICE-AUDIT]` is also captured into a buffer the in-app debug panel
 * can render. This keeps the existing forensic logging flow intact (DevTools
 * still sees everything) while letting the staging-only VoiceAuditPanel show
 * the same trace on a phone where DevTools isn't practical.
 *
 * Captures the original console functions on first import so subsequent
 * imports are idempotent and safe in fast-refresh environments.
 */
const PREFIX = '[VOICE-AUDIT]';
const MAX_EVENTS = 500;

export interface VoiceAuditEvent {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  data: unknown;
}

const buffer: VoiceAuditEvent[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) {
    try { l(); } catch {}
  }
}

function push(level: VoiceAuditEvent['level'], args: unknown[]): void {
  const first = args[0];
  if (typeof first !== 'string' || !first.startsWith(PREFIX)) return;
  const message = first.slice(PREFIX.length).trim();
  const data = args.length > 1 ? (args.length === 2 ? args[1] : args.slice(1)) : undefined;
  buffer.push({ ts: Date.now(), level, message, data });
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
  notify();
}

let installed = false;
export function installVoiceAuditCapture(): void {
  if (installed) return;
  if (typeof console === 'undefined') return;
  installed = true;
  const origInfo = console.info?.bind(console);
  const origWarn = console.warn?.bind(console);
  const origError = console.error?.bind(console);
  if (origInfo) {
    console.info = (...args: unknown[]) => {
      push('info', args);
      origInfo(...args);
    };
  }
  if (origWarn) {
    console.warn = (...args: unknown[]) => {
      push('warn', args);
      origWarn(...args);
    };
  }
  if (origError) {
    console.error = (...args: unknown[]) => {
      push('error', args);
      origError(...args);
    };
  }
}

export function getVoiceAuditEvents(): VoiceAuditEvent[] {
  return buffer.slice();
}

export function clearVoiceAuditEvents(): void {
  buffer.length = 0;
  notify();
}

export function subscribeVoiceAudit(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  }
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    try { return String(value); } catch { return '<unserializable>'; }
  }
}

export function formatEventLine(e: VoiceAuditEvent): string {
  const t = new Date(e.ts).toISOString().slice(11, 23);
  const lvl = e.level.toUpperCase().padEnd(5);
  const data = safeStringify(e.data);
  return data ? `${t} ${lvl} ${e.message} ${data}` : `${t} ${lvl} ${e.message}`;
}

export function buildExportText(header: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push('=== VOICE-AUDIT log ===');
  for (const [k, v] of Object.entries(header)) {
    lines.push(`${k}: ${safeStringify(v)}`);
  }
  lines.push('---');
  for (const e of buffer) lines.push(formatEventLine(e));
  lines.push('=== end ===');
  return lines.join('\n');
}
