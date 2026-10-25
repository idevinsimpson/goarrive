import { createHash, randomUUID } from 'crypto';
import { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
export function normalizeBotEmail(value: unknown): string {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new HttpsError('invalid-argument', 'Valid host email required');
  return value.trim().toLowerCase();
}
export function botHostKey(email: string): string { return createHash('sha256').update(normalizeBotEmail(email)).digest('hex'); }
type Window = { sessionId: string; startMs: number; endMs: number };
export type BotReservation = { create: boolean; attemptId: string; hostId: string; hostEmail: string; providerUserId: string; sessionId: string };
/** Server-only verified registry and lease documents. Never trusts coach-editable zoom_rooms. */
export async function reserveBotHost(db: Firestore, sessionId: string, coachId: string, now = Date.now()): Promise<BotReservation> {
  const attemptId = randomUUID();
  return db.runTransaction(async tx => {
    const sessionRef = db.doc(`session_instances/${sessionId}`), jobRef = db.doc(`zoom_bot_allocation_jobs/${sessionId}`), cursorRef = db.doc('zoom_bot_pool_state/hmti');
    const [sessionDoc, jobDoc, cursorDoc, hosts] = await Promise.all([tx.get(sessionRef), tx.get(jobRef), tx.get(cursorRef), tx.get(db.collection('zoom_bot_hosts').where('status', '==', 'active'))]);
    const s = sessionDoc.data();
    if (!s || s.coachId !== coachId || s.roomSource !== 'shared_pool') throw new HttpsError('permission-denied', 'Session is not assigned to this shared pool');
    const startMs = s.startUtc?.toMillis?.(), endMs = s.endUtc?.toMillis?.();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs || endMs <= now) throw new HttpsError('failed-precondition', 'Session timing is invalid or ended');
    const existing = jobDoc.data();
    if (existing && (existing.coachId !== coachId || existing.memberId !== s.memberId || existing.playbookId !== (s.playbookId || null) || existing.startMs !== startMs || existing.endMs !== endMs || existing.recordingEnabled !== (s.recordingEnabled === true))) throw new HttpsError('failed-precondition', 'Existing provider attempt requires reconciliation');
    if (existing) return { create: false, attemptId: existing.attemptId, hostId: existing.hostId, hostEmail: existing.hostEmail, providerUserId: existing.providerUserId, sessionId };
    if (!['scheduled', 'allocation_failed'].includes(s.status)) throw new HttpsError('failed-precondition', 'Session is already allocated or not bookable');
    const eligible = hosts.docs.filter(d => {
      const h = d.data();
      return h.poolId === 'hmti' && h.verified === true && h.providerMode === 'live' && h.isBot === true &&
        typeof h.providerUserId === 'string' && !!h.providerUserId && typeof h.email === 'string' &&
        h.email === normalizeBotEmail(h.email) && d.id === botHostKey(h.email) &&
        Number.isInteger(h.maxConcurrentMeetings) && h.maxConcurrentMeetings >= 1 && h.maxConcurrentMeetings <= 10;
    });
    const leases = await Promise.all(eligible.map(h => tx.get(db.doc(`zoom_bot_host_leases/${h.id}`))));
    const cursor = cursorDoc.data() || {}, order = cursor.lastSelected || {};
    const candidates = eligible.map((h, i) => {
      const windows: Window[] = (leases[i].data()?.windows || []).filter((w: Window) => w.endMs > now);
      return { h, windows, load: peakConcurrent(windows, startMs, endMs) };
    }).filter(x => x.load < x.h.data().maxConcurrentMeetings).sort((a,b) => (order[a.h.id] || 0) - (order[b.h.id] || 0) || a.h.id.localeCompare(b.h.id));
    const selected = candidates[0];
    if (!selected) throw new HttpsError('resource-exhausted', 'No verified bot host has capacity for this time');
    const h = selected.h.data(), sequence = (cursor.sequence || 0) + 1;
    const result = { attemptId, hostId: selected.h.id, hostEmail: h.email, providerUserId: h.providerUserId, sessionId };
    tx.set(jobRef, { ...result, state: 'reserved', coachId, memberId: s.memberId, playbookId: s.playbookId || null, startMs, endMs, recordingEnabled: s.recordingEnabled === true, createdAtMs: now });
    tx.set(db.doc(`zoom_bot_host_leases/${selected.h.id}`), { windows: [...selected.windows, { sessionId, startMs, endMs }] });
    tx.set(cursorRef, { sequence, lastSelected: { ...order, [selected.h.id]: sequence } });
    return { ...result, create: true };
  });
}
/** One irreversible provider attempt per reserved session. Ambiguous outcomes stay quarantined. */
export async function beginBotMeeting(db: Firestore, reservation: BotReservation): Promise<boolean> {
  return db.runTransaction(async tx => {
    const ref = db.doc(`zoom_bot_allocation_jobs/${reservation.sessionId}`);
    const [jobDoc, sessionDoc, hostDoc] = await Promise.all([tx.get(ref), tx.get(db.doc(`session_instances/${reservation.sessionId}`)), tx.get(db.doc(`zoom_bot_hosts/${reservation.hostId}`))]);
    const job = jobDoc.data(), session = sessionDoc.data(), host = hostDoc.data();
    if (!job || job.attemptId !== reservation.attemptId || job.state !== 'reserved') return false;
    if (!session || !host || host.status !== 'active' || host.verified !== true || host.providerMode !== 'live' || host.isBot !== true || host.poolId !== 'hmti' || host.email !== job.hostEmail || host.providerUserId !== job.providerUserId ||
      session.coachId !== job.coachId || session.memberId !== job.memberId || (session.playbookId || null) !== job.playbookId || session.roomSource !== 'shared_pool' ||
      !['scheduled','allocation_failed'].includes(session.status) || session.startUtc?.toMillis?.() !== job.startMs || session.endUtc?.toMillis?.() !== job.endMs || (session.recordingEnabled === true) !== job.recordingEnabled) {
      tx.update(ref, { state: 'needs_reconciliation' }); return false;
    }
    tx.update(ref, { state: 'provider_started' }); return true;
  });
}

export function peakConcurrent(windows: Window[], startMs: number, endMs: number): number {
  const events = windows.filter(w => w.startMs < endMs && startMs < w.endMs).flatMap(w => [[Math.max(startMs, w.startMs), 1], [Math.min(endMs, w.endMs), -1]]);
  events.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  let count=0, peak=0; for(const [,change] of events){count+=change;peak=Math.max(peak,count);} return peak;
}
