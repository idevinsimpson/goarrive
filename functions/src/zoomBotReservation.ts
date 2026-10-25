import { createHash, randomUUID } from 'crypto';
import { Firestore } from 'firebase-admin/firestore';
import { wallTimeToUtc } from './playbookScheduling';
import { HttpsError } from 'firebase-functions/v2/https';
export function normalizeBotEmail(value: unknown): string {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new HttpsError('invalid-argument', 'Valid host email required');
  return value.trim().toLowerCase();
}
export function botHostKey(email: string): string { return createHash('sha256').update(normalizeBotEmail(email)).digest('hex'); }
export const BOT_EARLY_JOIN_MS = 300000;
type Window = { sessionId: string; startMs: number; endMs: number; attemptId?: string; unresolved?: boolean; released?: boolean };
const occupancy = (w: Window, now: number): Window => ({ ...w, startMs: w.startMs - BOT_EARLY_JOIN_MS, endMs: w.unresolved || w.endMs <= now ? Number.MAX_SAFE_INTEGER : w.endMs });
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
      return h.poolId === 'hmti' && Array.isArray(h.inventory) && Number.isFinite(h.inventoryObservedAtMs) && now >= h.inventoryObservedAtMs && now - h.inventoryObservedAtMs < 30000 && typeof h.roomId === 'string' && h.roomId.length > 0 && Number.isSafeInteger(h.mappingVersion) && h.mappingVersion > 0 && h.reconciled === true && Array.isArray(h.legacyRoomIds) && h.legacyRoomIds.length <= 20 && h.verified === true && h.providerMode === 'live' && h.isBot === true &&
        typeof h.providerUserId === 'string' && !!h.providerUserId && typeof h.email === 'string' &&
        h.email === normalizeBotEmail(h.email) && d.id === botHostKey(h.email) &&
        Number.isInteger(h.maxConcurrentMeetings) && h.maxConcurrentMeetings === 1;
    });
    const roomDocs = await Promise.all(eligible.map(h => tx.get(db.doc(`zoom_rooms/${h.data().roomId}`))));
    const leases = await Promise.all(eligible.map(h => tx.get(db.doc(`zoom_bot_host_leases/${h.id}`))));
    const legacy = await Promise.all(eligible.map(async h => {
      const snapshots = await Promise.all([...new Set<string>([h.data().roomId,...h.data().legacyRoomIds])].map(id => tx.get(db.collection('session_instances').where('zoomRoomId', '==', id).limit(201))));
      if (snapshots.some(x => x.size > 200)) throw new HttpsError('failed-precondition', 'Legacy room history needs reconciliation');
      const docs = [...new Map(snapshots.flatMap(x => x.docs).map(d => [d.id,d])).values()].filter(d => d.data().zoomMeetingId);
      const releases = await Promise.all(docs.map(d => tx.get(db.doc(`zoom_bot_legacy_releases/${d.id}`))));
      return docs.filter((d,i) => { const proof = releases[i].data(); return !(proof?.meetingId === d.data().zoomMeetingId && proof?.providerUserId === h.data().providerUserId && Number.isFinite(proof?.verifiedReleasedAtMs)); }).map(d => legacyWindow(d.id,d.data()));
    }));
    const cursor = cursorDoc.data() || {}, order = cursor.lastSelected || {};
    const candidates = eligible.map((h, i) => {
      const own: Window[] = (leases[i].data()?.windows || []).filter((w: Window) => w.released !== true);
      const external: Window[] = h.data().inventory.map((m:any)=>({sessionId:'provider:'+m.meetingId,startMs:m.startMs??0,endMs:m.endMs??Number.MAX_SAFE_INTEGER,unresolved:m.live||m.startMs===null||m.endMs===null}));
      const windows = [...new Map([...legacy[i], ...own].map(w => [w.sessionId, w])).values(),...external];
      return { h, room: roomDocs[i], windows: own, load: peakConcurrent(windows.map(w => occupancy(w, now)), startMs - BOT_EARLY_JOIN_MS, endMs) };
    }).filter(x => {const r=x.room.data();return r?.status==='active'&&r.poolId==='hmti'&&r.zoomAccountEmail===x.h.data().email&&r.zoomUserId===x.h.data().providerUserId&&x.load < x.h.data().maxConcurrentMeetings;}).sort((a,b) => (order[a.h.id] || 0) - (order[b.h.id] || 0) || a.h.id.localeCompare(b.h.id));
    const selected = candidates[0];
    if (!selected) throw new HttpsError('resource-exhausted', 'No verified bot host has capacity for this time');
    const h = selected.h.data(), sequence = (cursor.sequence || 0) + 1;
    const result = { attemptId, hostId: selected.h.id, hostEmail: h.email, providerUserId: h.providerUserId, sessionId };
    tx.set(jobRef, { ...result, state: 'reserved', roomId: h.roomId, mappingVersion: h.mappingVersion, roomVersionMs: selected.room.updateTime!.toMillis(), coachId, memberId: s.memberId, playbookId: s.playbookId || null, startMs, endMs, recordingEnabled: s.recordingEnabled === true, createdAtMs: now });
    tx.set(db.doc(`zoom_bot_host_leases/${selected.h.id}`), { windows: [...selected.windows, { sessionId, startMs, endMs, attemptId }] });
    tx.set(cursorRef, { sequence, lastSelected: { ...order, [selected.h.id]: sequence } });
    return { ...result, create: true };
  });
}
/** One irreversible provider attempt per reserved session. Ambiguous outcomes stay quarantined. */
export async function beginBotMeeting(db: Firestore, reservation: BotReservation, now?: number): Promise<false | Record<string, any>> {
  return db.runTransaction(async tx => {
    const ref = db.doc(`zoom_bot_allocation_jobs/${reservation.sessionId}`);
    const leaseRef=db.doc(`zoom_bot_host_leases/${reservation.hostId}`);
    const [jobDoc, sessionDoc, hostDoc, leaseDoc] = await Promise.all([tx.get(ref), tx.get(db.doc(`session_instances/${reservation.sessionId}`)), tx.get(db.doc(`zoom_bot_hosts/${reservation.hostId}`)),tx.get(leaseRef)]);
    const job = jobDoc.data(), session = sessionDoc.data(), host = hostDoc.data();
    if (!job || job.attemptId !== reservation.attemptId || job.state !== 'reserved') return false;
    const roomDoc=await tx.get(db.doc(`zoom_rooms/${job.roomId}`));
    if (roomDoc.updateTime?.toMillis() !== job.roomVersionMs || job.endMs <= (now ?? Date.now()) || !session || !host || host.reconciled !== true || !Number.isFinite(host.inventoryObservedAtMs) || (now ?? Date.now()) - host.inventoryObservedAtMs >= 30000 || host.roomId !== job.roomId || host.mappingVersion !== job.mappingVersion || host.status !== 'active' || host.verified !== true || host.providerMode !== 'live' || host.isBot !== true || host.poolId !== 'hmti' || host.email !== job.hostEmail || host.providerUserId !== job.providerUserId ||
      session.coachId !== job.coachId || session.memberId !== job.memberId || (session.playbookId || null) !== job.playbookId || session.roomSource !== 'shared_pool' ||
      !['scheduled','allocation_failed'].includes(session.status) || session.startUtc?.toMillis?.() !== job.startMs || session.endUtc?.toMillis?.() !== job.endMs || (session.recordingEnabled === true) !== job.recordingEnabled) {
      tx.update(ref, { state: 'needs_reconciliation' }); return false;
    }
    tx.update(ref, { state: 'provider_started' });
    tx.update(leaseRef,{windows:(leaseDoc.data()?.windows||[]).map((w:Window)=>w.sessionId===reservation.sessionId&&w.attemptId===reservation.attemptId?{...w,unresolved:true}:w)});return job;
  });
}

export function peakConcurrent(windows: Window[], startMs: number, endMs: number): number {
  const events = windows.filter(w => w.startMs < endMs && startMs < w.endMs).flatMap(w => [[Math.max(startMs, w.startMs), 1], [Math.min(endMs, w.endMs), -1]]);
  events.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  let count=0, peak=0; for(const [,change] of events){count+=change;peak=Math.max(peak,count);} return peak;
}

function legacyWindow(sessionId: string, s: Record<string, any>): Window {
  let startMs = s.startUtc?.toMillis?.(), endMs = s.endUtc?.toMillis?.();
  if (!Number.isFinite(startMs) && s.scheduledDate && s.scheduledStartTime && s.timezone) startMs = wallTimeToUtc(s.scheduledDate, s.scheduledStartTime, s.timezone).getTime();
  if (!Number.isFinite(endMs) && Number.isFinite(startMs) && Number.isFinite(s.durationMinutes) && s.durationMinutes > 0) endMs = startMs + s.durationMinutes * 60000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new HttpsError('failed-precondition', 'Legacy meeting timing needs reconciliation');
  return { sessionId, startMs, endMs };
}
