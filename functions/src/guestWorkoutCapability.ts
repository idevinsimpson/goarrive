import { createHash, randomBytes } from 'crypto';

/** Internal capability core, used by the hard-disabled runtime and local fixtures.
 * Never substitute booking/share-token access for a guest capability. */
export type Assignment = { coachId: string; playbookId: string; memberId: string; generation: string; active: boolean };
export type Grant = Assignment & { digest: string; expiresAt: number; revoked: boolean };
export type Session = { id: string; coachId: string; playbookId: string; memberId: string; start: number; end: number;
  status: string; completed: boolean; pinnedWorkoutId?: string; scheduledWorkoutId?: string };
export type Plan = { coachId: string; workoutIds: string[]; nextWorkoutIndex: number };
export type Coach = { uid: string; role: string; coachId?: string };
export type Gate = { enabled?: boolean; mediaReady?: boolean; assignmentGenerationReady?: boolean };
export const unavailable = () => new Error('This workout link is unavailable.');
export const capabilityDigest = (token: string) => createHash('sha256').update(token).digest('hex');
const sameAssignment = (a: Assignment, b: Assignment) => a.coachId === b.coachId && a.playbookId === b.playbookId && a.memberId === b.memberId && a.generation === b.generation;
const gateOpen = (g: Gate) => g.enabled === true && g.mediaReady === true && g.assignmentGenerationReady === true;
const owner = (c: Coach, a: Assignment) => c.role === 'coach' && (c.coachId || c.uid) === a.coachId;

/** Store must atomically re-read assignment, invalidate old grant, and save digest.
 * Assignment generation must be server-owned and change on remove/re-add/reassign.
 * Never derive it from a client-editable Playbook field or asynchronous trigger.
 */
export interface CapabilityStore {
  rotate(assignment: Assignment, grant: Grant): Promise<void>;
  revoke(assignment: Assignment): Promise<void>;
  read(digest: string): Promise<Grant | undefined>;
  assignment(grant: Grant): Promise<Assignment | undefined>;
  schedule(assignment: Assignment): Promise<{ plan: Plan; sessions: Session[] }>;
  /** Final grant, assignment and schedule must come from one read transaction. */
  refresh(digest: string): Promise<{ grant?: Grant; assignment?: Assignment; plan: Plan; sessions: Session[] }>;
}

export class GuestWorkoutCapabilities {
  constructor(private store: CapabilityStore, private gate: Gate = {}, private clock = Date.now,
    private entropy: () => Buffer = () => randomBytes(32)) {}

  async issue(coach: Coach, assignment: Assignment, confirmed: boolean, expiresAt: number) {
    const now = this.clock();
    if (!gateOpen(this.gate) || !owner(coach, assignment) || !assignment.active || !assignment.generation || !confirmed ||
      !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 7 * 86400000) throw unavailable();
    const bytes = this.entropy();
    if (bytes.length !== 32) throw unavailable();
    const token = bytes.toString('base64url');
    await this.store.rotate(assignment, { ...assignment, digest: capabilityDigest(token), expiresAt, revoked: false });
    // Reveal once; never log, persist plaintext, or include in error messages.
    return { token, expiresAt };
  }

  async revoke(coach: Coach, assignment: Assignment) {
    // Revocation remains possible even while rollout is off.
    if (!owner(coach, assignment)) throw unavailable();
    await this.store.revoke(assignment);
  }

  async resolve(token: string) {
    if (!gateOpen(this.gate) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const grant = await this.store.read(capabilityDigest(token)), now = this.clock();
    if (!grant || grant.revoked || !grant.active || now >= grant.expiresAt) throw unavailable();
    const assignment = await this.store.assignment(grant);
    if (!assignment?.active || !sameAssignment(grant, assignment)) throw unavailable();
    const { plan, sessions } = await this.store.schedule(assignment);
    if (plan.coachId !== assignment.coachId) throw unavailable();
    const eligible = (rows: Session[], at: number) => rows.filter(s => s.coachId === assignment.coachId && s.playbookId === assignment.playbookId &&
      s.memberId === assignment.memberId && !s.completed && ['scheduled', 'allocated', 'in_progress', 'allocation_failed', 'completed'].includes(s.status) &&
      Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && at >= s.start - 300000 && at < s.end);
    const candidates = eligible(sessions, now);
    if (candidates.length !== 1) throw unavailable();
    const session = candidates[0], ids = plan.workoutIds;
    const index = Number.isInteger(plan.nextWorkoutIndex) ? plan.nextWorkoutIndex : 0;
    const workoutId = session.pinnedWorkoutId || session.scheduledWorkoutId || (ids.length ? ids[((index % ids.length) + ids.length) % ids.length] : undefined);
    if (!workoutId) throw unavailable();
    const final = await this.store.refresh(grant.digest), fresh = final.grant, current = final.assignment, finishedAt = this.clock();
    const latest = eligible(final.sessions, finishedAt);
    if (!fresh || fresh.revoked || !fresh.active || finishedAt >= fresh.expiresAt || !current?.active || !sameAssignment(grant, current) ||
      final.plan.coachId !== plan.coachId || JSON.stringify(final.plan) !== JSON.stringify(plan) || latest.length !== 1 ||
      JSON.stringify(latest[0]) !== JSON.stringify(session)) throw unavailable();
    // Internal selection only, never a public response. Media adapter must revalidate
    // this admission and ownership before explicit field projection/stream delivery.
    return { sessionId: session.id, workoutId, coachId: assignment.coachId,
      validUntil: Math.min(fresh.expiresAt, session.end, finishedAt + 25000), digest: grant.digest };
  }
}
