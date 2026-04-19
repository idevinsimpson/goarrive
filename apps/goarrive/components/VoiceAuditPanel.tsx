/**
 * VoiceAuditPanel — Staging-only in-app overlay that mirrors the [VOICE-AUDIT]
 * console trace so the silent-movement bug can be diagnosed on a phone without
 * DevTools.
 *
 * Renders two surfaces:
 *   • A small fixed pill in the top-right of the player ("VA <n>") that
 *     toggles the expanded panel. Number = total captured events.
 *   • An expanded panel showing the per-movement summary table (name,
 *     movementId, voiceUrl present, isGlobal, snapshot OK / DENIED / MISSING,
 *     enqueue + playback outcome) plus the raw event tail.
 *
 * Copy Debug Log writes the full export to the system clipboard so the user
 * can paste it into Slack. Falls back to a selectable textarea on platforms
 * where async clipboard isn't available.
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform,
  TextInput,
} from 'react-native';
import {
  getVoiceAuditEvents, subscribeVoiceAudit, clearVoiceAuditEvents,
  buildExportText, formatEventLine,
  type VoiceAuditEvent,
} from '../lib/voiceAuditLog';

interface MovementRow {
  movementId: string;
  name: string;
  blockVoiceUrl: 'present' | 'empty' | 'unknown';
  snapshot: 'pending' | 'ok' | 'missing' | 'denied';
  canonicalName: string;
  voiceUrlPresent: boolean | null;
  isGlobal: boolean | null;
  voiceText: boolean | null;
  backfillCalled: boolean;
  backfillOutcome: 'pending' | 'ok' | 'no-url' | 'rejected' | 'skipped-empty-text';
  writebackServerEvent: 'unknown' | 'ok' | 'missing' | 'failed';
  enqueue: 'idle' | 'queued' | 'dropped-muted' | 'dropped-empty' | 'pending-late' | 'late-skipped' | 'late-queued';
  enqueueContexts: string[];
  silentReason: string;
  events: VoiceAuditEvent[];
}

interface PanelProps {
  workoutId?: string;
  workoutTitle?: string;
  isMuted: boolean;
  ttsDisabled?: boolean;
  phase: string;
  currentIndex: number;
  current: any;
  next: any;
  hydratedMovements: any[];
}

function shortId(id?: string): string {
  if (!id) return '(none)';
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function buildMovementRows(
  hydrated: any[],
  events: VoiceAuditEvent[],
): MovementRow[] {
  const exerciseRows = hydrated.filter(
    (m) => m && m.stepType === 'exercise' && m.movementIndex !== -1,
  );
  // Dedupe by movementId so multi-round blocks don't appear twice.
  const seen = new Set<string>();
  const rows: MovementRow[] = [];
  for (const m of exerciseRows) {
    const key = m.movementId || `__missing_${m.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      movementId: m.movementId || '',
      name: m.name || '(unnamed)',
      blockVoiceUrl: m.voiceUrl ? 'present' : 'empty',
      snapshot: 'pending',
      canonicalName: '',
      voiceUrlPresent: null,
      isGlobal: null,
      voiceText: null,
      backfillCalled: false,
      backfillOutcome: 'pending',
      writebackServerEvent: 'unknown',
      enqueue: 'idle',
      enqueueContexts: [],
      silentReason: '',
      events: [],
    });
  }

  const byId = new Map<string, MovementRow>();
  const byName = new Map<string, MovementRow>();
  for (const r of rows) {
    if (r.movementId) byId.set(r.movementId, r);
    if (r.name) byName.set(r.name, r);
  }

  function locateRow(d: any): MovementRow | undefined {
    if (!d || typeof d !== 'object') return undefined;
    const id = (d as any).movementId || (d as any).pendingId || (d as any).nextMovementId;
    if (id && byId.has(id)) return byId.get(id);
    const name = (d as any).name || (d as any).movementName || (d as any).nextName;
    if (name && byName.has(name)) return byName.get(name);
    // enqueueVoice events only carry a context string like
    // "rest_next_up_<name>" or "work_<idx>_<name>". Try to recover the row
    // by suffix-match against known names.
    const ctx = (d as any).context;
    if (typeof ctx === 'string') {
      for (const r of rows) {
        if (r.name && ctx.includes(r.name)) return r;
      }
    }
    return undefined;
  }

  for (const e of events) {
    const row = locateRow(e.data);
    if (row) row.events.push(e);

    if (e.message.startsWith('onSnapshot movement doc') && row) {
      row.snapshot = 'ok';
      const d: any = e.data;
      row.canonicalName = d?.name || row.canonicalName;
      row.voiceUrlPresent = !!d?.voiceUrlPresent;
      row.voiceText = !!d?.voiceTextPresent;
      if (typeof d?.isGlobal === 'boolean') row.isGlobal = d.isGlobal;
    } else if (e.message.startsWith('canonical movement doc MISSING') && row) {
      row.snapshot = 'missing';
    } else if (e.message.startsWith('onSnapshot ERROR') && row) {
      row.snapshot = 'denied';
    } else if (e.message.startsWith('triggering voice backfill') && row) {
      row.backfillCalled = true;
    } else if (e.message.startsWith('backfill returned URL') && row) {
      row.backfillOutcome = 'ok';
    } else if (e.message.startsWith('backfill returned NO URL') && row) {
      row.backfillOutcome = 'no-url';
    } else if (e.message.startsWith('backfill REJECTED') && row) {
      row.backfillOutcome = 'rejected';
    } else if (e.message.startsWith('generateMovementVoice skipped') && row) {
      row.backfillOutcome = 'skipped-empty-text';
    } else if (e.message.startsWith('rest entry — next-up voice state') && row) {
      // No explicit enqueue marker yet, that follows.
    } else if (e.message.startsWith('enqueueVoice queued') && row) {
      row.enqueue = 'queued';
      const ctx = (e.data as any)?.context;
      if (ctx && !row.enqueueContexts.includes(ctx)) row.enqueueContexts.push(ctx);
    } else if (e.message.startsWith('enqueueVoice dropped — muted')) {
      const fallbackRow = locateRow(e.data) || rows.find(r => (e.data as any)?.context?.includes(r.name));
      if (fallbackRow) {
        fallbackRow.enqueue = 'dropped-muted';
        fallbackRow.silentReason = 'audio is muted or TTS disabled';
      }
    } else if (e.message.startsWith('enqueueVoice dropped — empty url')) {
      const fallbackRow = locateRow(e.data) || rows.find(r => (e.data as any)?.context?.includes(r.name));
      if (fallbackRow) {
        fallbackRow.enqueue = 'dropped-empty';
        if (!fallbackRow.silentReason) fallbackRow.silentReason = 'voiceUrl was empty at enqueue time';
      }
    } else if (e.message.startsWith('pending late-arrival watcher armed') && row) {
      row.enqueue = 'pending-late';
    } else if (e.message.startsWith('late voiceUrl arrived inside rest countdown') && row) {
      row.enqueue = 'late-skipped';
      if (!row.silentReason) row.silentReason = 'voiceUrl arrived inside last 3.5s of rest';
    } else if (e.message.startsWith('late voiceUrl arrived — enqueuing') && row) {
      row.enqueue = 'late-queued';
    }
  }

  // Derive silentReason for any row that ended up silent without an explicit one.
  for (const r of rows) {
    if (r.silentReason) continue;
    if (r.snapshot === 'denied') {
      r.silentReason = 'Firestore denied read of /movements/{id} — rules block member';
    } else if (r.snapshot === 'missing') {
      r.silentReason = 'canonical /movements/{id} doc does not exist';
    } else if (r.voiceUrlPresent === false && r.backfillOutcome === 'pending') {
      r.silentReason = 'no voiceUrl + backfill not yet triggered';
    } else if (r.backfillOutcome === 'no-url' || r.backfillOutcome === 'rejected') {
      r.silentReason = `backfill failed (${r.backfillOutcome})`;
    } else if (r.enqueue === 'idle' && r.snapshot === 'ok' && r.voiceUrlPresent) {
      r.silentReason = '(not played yet — has not reached this rest screen)';
    }
  }

  return rows;
}

export default function VoiceAuditPanel(props: PanelProps) {
  const {
    workoutId, workoutTitle, isMuted, ttsDisabled,
    phase, currentIndex, current, next, hydratedMovements,
  } = props;
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [exportText, setExportText] = useState<string>('');
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<TextInput>(null);

  useEffect(() => subscribeVoiceAudit(() => force((n) => n + 1)), []);

  const events = getVoiceAuditEvents();
  const rows = useMemo(
    () => buildMovementRows(hydratedMovements, events),
    [hydratedMovements, events],
  );

  const currentName = current?.name;
  const currentMovementId = current?.movementId;
  const nextName = next?.name;
  const nextMovementId = next?.movementId;
  const header = useMemo(() => ({
    workoutId: workoutId || '(unknown)',
    workoutTitle: workoutTitle || '(unknown)',
    isMuted,
    ttsDisabled: !!ttsDisabled,
    phase,
    currentIndex,
    currentName,
    currentMovementId,
    nextName,
    nextMovementId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    href: typeof window !== 'undefined' ? window.location?.href : 'n/a',
    capturedAt: new Date().toISOString(),
  }), [workoutId, workoutTitle, isMuted, ttsDisabled,
       phase, currentIndex, currentName, currentMovementId,
       nextName, nextMovementId]);

  const onCopy = useCallback(async () => {
    const text = buildExportText(header);
    setExportText(text);
    let ok = false;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined'
          && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {}
    if (!ok) {
      setShowExport(true);
      setTimeout(() => exportRef.current?.focus(), 50);
    }
    setCopyState(ok ? 'copied' : 'error');
    setTimeout(() => setCopyState('idle'), 2000);
  }, [header]);

  const onClear = useCallback(() => {
    clearVoiceAuditEvents();
    setShowExport(false);
    setExportText('');
  }, []);

  const tail = events.slice(-40);

  return (
    <>
      <TouchableOpacity
        style={st.pill}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.8}
      >
        <Text style={st.pillText}>VA {events.length}</Text>
      </TouchableOpacity>

      {open && (
        <View style={st.panel} pointerEvents="box-none">
          <View style={st.panelInner}>
            <View style={st.headerRow}>
              <Text style={st.title}>VOICE-AUDIT (staging)</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={st.closeBtn}>
                <Text style={st.closeBtnText}>×</Text>
              </TouchableOpacity>
            </View>

            <Text style={st.sub}>
              workout {header.workoutTitle} · {shortId(header.workoutId)} · phase {header.phase} · idx {header.currentIndex}
              {header.isMuted ? ' · MUTED' : ''}
            </Text>
            <Text style={st.sub}>
              current: {header.currentName || '—'} ({shortId(header.currentMovementId)})  ·  next: {header.nextName || '—'} ({shortId(header.nextMovementId)})
            </Text>

            <View style={st.actionRow}>
              <TouchableOpacity onPress={onCopy} style={st.actionBtn}>
                <Text style={st.actionBtnText}>
                  {copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Select & copy ↓' : 'Copy Debug Log'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClear} style={[st.actionBtn, st.actionBtnAlt]}>
                <Text style={st.actionBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent}>
              <Text style={st.sectionLabel}>Per-movement state</Text>
              {rows.length === 0 && (
                <Text style={st.muted}>No exercise movements yet…</Text>
              )}
              {rows.map((r) => (
                <View key={r.movementId || r.name} style={st.row}>
                  <Text style={st.rowName}>{r.name}</Text>
                  <Text style={st.rowMeta}>id: {r.movementId || '(MISSING)'}</Text>
                  <Text style={st.rowMeta}>
                    canonical: {r.snapshot === 'ok' ? 'YES' : r.snapshot === 'denied' ? 'DENIED' : r.snapshot === 'missing' ? 'MISSING' : 'pending'}
                    {r.snapshot === 'ok' ? ` · readable YES` : r.snapshot === 'denied' ? ` · readable NO (rules)` : ''}
                  </Text>
                  <Text style={st.rowMeta}>
                    isGlobal: {r.isGlobal === null ? '?' : String(r.isGlobal)}
                    {' · '}voiceUrl: {r.voiceUrlPresent === null ? '?' : r.voiceUrlPresent ? 'YES' : 'NO'}
                    {' · '}block snapshot voiceUrl: {r.blockVoiceUrl}
                  </Text>
                  <Text style={st.rowMeta}>
                    backfill called: {r.backfillCalled ? 'YES' : 'no'} · outcome: {r.backfillOutcome}
                  </Text>
                  <Text style={st.rowMeta}>
                    enqueue: {r.enqueue}
                    {r.enqueueContexts.length > 0 ? ` (${r.enqueueContexts.join(', ')})` : ''}
                  </Text>
                  {r.silentReason ? (
                    <Text style={st.rowReason}>silent reason: {r.silentReason}</Text>
                  ) : null}
                </View>
              ))}

              <Text style={[st.sectionLabel, { marginTop: 12 }]}>
                Recent events (last {tail.length} of {events.length})
              </Text>
              {tail.map((e, i) => (
                <Text key={i} style={[
                  st.eventLine,
                  e.level === 'warn' ? st.eventWarn : null,
                  e.level === 'error' ? st.eventError : null,
                ]}>
                  {formatEventLine(e)}
                </Text>
              ))}
            </ScrollView>

            {showExport && (
              <View style={st.exportBox}>
                <Text style={st.muted}>
                  Auto-copy unavailable. Long-press inside the box, Select All, then Copy.
                </Text>
                <TextInput
                  ref={exportRef}
                  style={st.exportInput}
                  value={exportText}
                  multiline
                  editable
                  selectTextOnFocus
                />
              </View>
            )}
          </View>
        </View>
      )}
    </>
  );
}

const st = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(245, 166, 35, 0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    zIndex: 9999,
    ...(Platform.OS === 'web' ? ({ pointerEvents: 'auto' } as any) : null),
  },
  pillText: { color: '#0E1117', fontSize: 11, fontWeight: '700' },
  panel: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9998,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    padding: 8,
  },
  panelInner: {
    backgroundColor: 'rgba(14,17,23,0.97)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F5A623',
    flex: 1,
    padding: 10,
    marginTop: 36,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#F5A623', fontSize: 13, fontWeight: '700' },
  closeBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  closeBtnText: { color: '#FFFFFF', fontSize: 18, lineHeight: 18 },
  sub: { color: '#B7C0CC', fontSize: 10, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnAlt: { backgroundColor: '#3A4050' },
  actionBtnText: { color: '#0E1117', fontSize: 11, fontWeight: '700' },
  scroll: { flex: 1, marginTop: 8 },
  scrollContent: { paddingBottom: 12 },
  sectionLabel: { color: '#F5A623', fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  muted: { color: '#8A95A3', fontSize: 10 },
  row: {
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    paddingVertical: 6,
  },
  rowName: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  rowMeta: { color: '#B7C0CC', fontSize: 10, marginTop: 1 },
  rowReason: { color: '#FF6B6B', fontSize: 10, marginTop: 2, fontWeight: '600' },
  eventLine: {
    color: '#B7C0CC',
    fontSize: 9,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'Courier' }),
    marginTop: 1,
  },
  eventWarn: { color: '#F5A623' },
  eventError: { color: '#FF6B6B' },
  exportBox: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    paddingTop: 8,
  },
  exportInput: {
    color: '#FFFFFF',
    backgroundColor: '#1A2035',
    fontSize: 10,
    fontFamily: Platform.select({ web: 'ui-monospace, monospace', default: 'Courier' }),
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    minHeight: 120,
    maxHeight: 240,
  },
});
