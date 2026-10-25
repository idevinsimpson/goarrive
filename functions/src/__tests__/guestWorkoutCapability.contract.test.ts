import { Assignment, Grant, GuestWorkoutCapabilities, Session, capabilityDigest } from '../guestWorkoutCapability';

const assignment: Assignment = { coachId: 'coach', playbookId: 'plan', memberId: 'member', generation: 'generation-1', active: true };
const coach = { uid: 'coach', role: 'coach' };
const now = Date.parse('2026-11-01T06:15:00Z'); // repeated New York 01:15, absolute scheduled instant
function fixture(gate = { enabled: true, mediaReady: true, assignmentGenerationReady: true }) {
  let current = { ...assignment }, clock = now, serial = 0;
  const grants = new Map<string, Grant>();
  const sessions: Session[] = [{ id: 'session', ...assignment, start: now - 60000, end: now + 60000, status: 'scheduled', completed: false }];
  const plan = { coachId: 'coach', workoutIds: ['A', 'B'], nextWorkoutIndex: 0 };
  const store = {
    rotate: jest.fn(async (a: Assignment, grant: Grant) => {
      if (JSON.stringify(a) !== JSON.stringify(current)) throw new Error('Assignment changed');
      for (const g of grants.values()) if (g.memberId === a.memberId && g.playbookId === a.playbookId) g.revoked = true;
      grants.set(grant.digest, grant);
    }),
    revoke: jest.fn(async (a: Assignment) => { for (const g of grants.values()) if (g.memberId === a.memberId && g.coachId === a.coachId && g.playbookId === a.playbookId) g.revoked = true; }),
    read: jest.fn(async (digest: string) => grants.get(digest)),
    assignment: jest.fn(async () => current),
    schedule: jest.fn(async () => ({ plan, sessions })),
  };
  // Fixed synthetic bytes only. No production capability is created by these tests.
  const service = new GuestWorkoutCapabilities(store, gate, () => clock, () => Buffer.alloc(32, ++serial));
  return { service, store, grants, sessions, plan, setAssignment: (a: Assignment) => current = a,
    setTime: (n: number) => clock = n, issue: () => service.issue(coach, assignment, true, now + 3600000) };
}

describe('guest capability offline security contract', () => {
  it.each([{ enabled: false, mediaReady: true, assignmentGenerationReady: true },
    { enabled: true, mediaReady: false, assignmentGenerationReady: true },
    { enabled: true, mediaReady: true, assignmentGenerationReady: false }])('fails closed before issuance/read when a gate is absent: %j', async gate => {
    const f = fixture(gate);
    await expect(f.issue()).rejects.toThrow('unavailable');
    await expect(f.service.resolve('x'.repeat(43))).rejects.toThrow('unavailable');
    expect(f.store.rotate).not.toHaveBeenCalled(); expect(f.store.read).not.toHaveBeenCalled();
  });
  it('defaults closed without configuration', async () => {
    const f = fixture(); const s = new GuestWorkoutCapabilities(f.store);
    await expect(s.issue(coach, assignment, true, now + 1000)).rejects.toThrow('unavailable');
  });
  it.each([{ uid: 'other', role: 'coach' }, { uid: 'coach', role: 'member' }, { uid: 'admin', role: 'platformAdmin' }])('requires owning coach: %j', async actor => {
    const f = fixture(); await expect(f.service.issue(actor, assignment, true, now + 1000)).rejects.toThrow('unavailable');
    await expect(f.service.revoke(actor, assignment)).rejects.toThrow('unavailable');
  });
  it('requires confirmation, active assignment and bounded expiry', async () => {
    const f = fixture();
    for (const expiry of [now, now - 1, now + 8 * 86400000, NaN]) await expect(f.service.issue(coach, assignment, true, expiry)).rejects.toThrow('unavailable');
    await expect(f.service.issue(coach, assignment, false, now + 1000)).rejects.toThrow('unavailable');
    await expect(f.service.issue(coach, { ...assignment, active: false }, true, now + 1000)).rejects.toThrow('unavailable');
  });
  it('stores only digest and selects current workout without writes on repeated resolution', async () => {
    const f = fixture(), { token } = await f.issue();
    expect(token).toHaveLength(43); expect(JSON.stringify([...f.grants.values()])).not.toContain(token);
    expect([...f.grants.keys()]).toEqual([capabilityDigest(token)]);
    expect(await f.service.resolve(token)).toMatchObject({ workoutId: 'A', validUntil: now + 25000 });
    await f.service.resolve(token); expect(f.store.rotate).toHaveBeenCalledTimes(1); expect(f.store.revoke).not.toHaveBeenCalled();
  });
  it('rotation revokes previous link and disable works with rollout off', async () => {
    const f = fixture(), old = await f.issue(), next = await f.issue();
    await expect(f.service.resolve(old.token)).rejects.toThrow('unavailable');
    expect((await f.service.resolve(next.token)).workoutId).toBe('A');
    await new GuestWorkoutCapabilities(f.store).revoke(coach, assignment);
    await expect(f.service.resolve(next.token)).rejects.toThrow('unavailable');
  });
  it.each(['coachId', 'memberId', 'playbookId', 'generation'] as const)('rejects changed assignment %s including remove/re-add generation', async key => {
    const f = fixture(), { token } = await f.issue(); f.setAssignment({ ...assignment, [key]: 'changed' });
    await expect(f.service.resolve(token)).rejects.toThrow('unavailable'); expect(f.store.schedule).not.toHaveBeenCalled();
  });
  it('rejects removed assignment and expires exactly at expiry', async () => {
    const f = fixture(), { token } = await f.issue(); f.setAssignment({ ...assignment, active: false });
    await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
    f.setAssignment(assignment); f.setTime(now + 3600000); await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
  });
  it('fails closed for malformed, unknown and guessed resource IDs with uniform error', async () => {
    const f = fixture(); for (const token of ['plan', '', 'x'.repeat(43), 'https://example.invalid']) await expect(f.service.resolve(token)).rejects.toThrow('This workout link is unavailable.');
  });
  it.each(['cancelled', 'completed'])('rejects %s sessions', async status => {
    const f = fixture(), { token } = await f.issue(); f.sessions[0].status = status; await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
  });
  it('uses absolute times across DST, excludes early/ended and overlapping sessions', async () => {
    const f = fixture(), { token } = await f.issue();
    f.setTime(f.sessions[0].start - 300001); await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
    f.setTime(f.sessions[0].start - 300000); expect((await f.service.resolve(token)).workoutId).toBe('A');
    f.setTime(f.sessions[0].end); await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
    f.setTime(now); f.sessions.push({ ...f.sessions[0], id: 'other' }); await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
  });
  it('never chooses another member/tenant; rescheduling affects eligibility', async () => {
    const f = fixture(), { token } = await f.issue(); f.sessions[0].memberId = 'other'; await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
    f.sessions[0].memberId = 'member'; f.sessions[0].start += 86400000; f.sessions[0].end += 86400000; await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
  });
  it('follows scheduled workout after missed session, carries forward otherwise, and preserves pin', async () => {
    const f = fixture(), { token } = await f.issue();
    f.sessions.push({ ...f.sessions[0], id: 'missed', start: now - 86400000, end: now - 86300000 });
    expect((await f.service.resolve(token)).workoutId).toBe('A');
    f.sessions[0].scheduledWorkoutId = 'B'; expect((await f.service.resolve(token)).workoutId).toBe('B');
    f.sessions[0].pinnedWorkoutId = 'A'; expect((await f.service.resolve(token)).workoutId).toBe('A');
    expect(f.plan.nextWorkoutIndex).toBe(0); expect(f.sessions.every(s => !s.completed)).toBe(true);
  });
  it('rejects revocation during an asynchronous schedule read', async () => {
    const f = fixture(), { token } = await f.issue();
    f.store.schedule.mockImplementationOnce(async () => { await f.service.revoke(coach, assignment); return { plan: f.plan, sessions: f.sessions }; });
    await expect(f.service.resolve(token)).rejects.toThrow('unavailable');
  });
});
