import { createGuestRuntime, guestRuntimeEnabled } from '../guestRuntime';
import { FirestoreGuestCapabilityStore } from '../guestCapabilityStore';
import { GuestRequestBudget } from '../guestDeliveryHttp';
const coach = { uid: 'coach', token: { role: 'coach' } };
afterEach(() => jest.restoreAllMocks());
test('production issuance/media cannot be activated by environment or synthetic flag', async () => {
  const old = process.env.GUEST_WORKOUT_ROLLOUT_ENABLED; process.env.GUEST_WORKOUT_ROLLOUT_ENABLED = 'true';
  try {
    expect(guestRuntimeEnabled('goarrive')).toBe(false); expect(guestRuntimeEnabled('goarrive', true)).toBe(false);
    const db = { doc: jest.fn() }, app: any = { options: { projectId: 'goarrive' }, firestore: () => db, storage: jest.fn() };
    const runtime = createGuestRuntime(app);
    expect(runtime.status(coach)).toMatchObject({ canIssue: false });
    await expect(runtime.issue(coach, { playbookId: 'plan', memberId: 'member', confirmed: true, expiresAt: Date.now() + 10000 })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(runtime.delivery.manifest('a'.repeat(43))).rejects.toThrow('unavailable');
    expect(db.doc).not.toHaveBeenCalled(); expect(app.storage).not.toHaveBeenCalled();
  } finally { if (old === undefined) delete process.env.GUEST_WORKOUT_ROLLOUT_ENABLED; else process.env.GUEST_WORKOUT_ROLLOUT_ENABLED = old; }
});
test('off-state revocation retains authenticated coach namespace and rejects member/anonymous', async () => {
  const revoke = jest.spyOn(FirestoreGuestCapabilityStore.prototype, 'revoke').mockResolvedValue(undefined);
  const runtime = createGuestRuntime({ options: { projectId: 'goarrive' }, firestore: () => ({}) } as any);
  await runtime.revoke(coach, { playbookId: 'plan', memberId: 'member' });
  expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ coachId: 'coach', playbookId: 'plan', memberId: 'member' }));
  await expect(runtime.revoke(null, { playbookId: 'plan', memberId: 'member' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(runtime.issue({ uid: 'member', token: { role: 'member' } }, {})).rejects.toMatchObject({ code: 'permission-denied' });
});
test('local fixture gate requires both exact loopback emulators and demo project', () => {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST, storage = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  try {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    expect(guestRuntimeEnabled('demo-test', true)).toBe(false);
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'; expect(guestRuntimeEnabled('demo-test', true)).toBe(true);
    expect(guestRuntimeEnabled('goarrive', true)).toBe(false); expect(guestRuntimeEnabled('demo-test')).toBe(false);
  } finally {
    if (firestore === undefined) delete process.env.FIRESTORE_EMULATOR_HOST; else process.env.FIRESTORE_EMULATOR_HOST = firestore;
    if (storage === undefined) delete process.env.FIREBASE_STORAGE_EMULATOR_HOST; else process.env.FIREBASE_STORAGE_EMULATOR_HOST = storage;
  }
});
test('HTTP budget bounds concurrency, per-capability and total instance requests', () => {
  let now = 0; const budget = new GuestRequestBudget(() => now);
  const first = budget.enter('one')!, second = budget.enter('two')!;
  expect(budget.enter('three')).toBeUndefined(); first(); first(); second();
  for (let i = 1; i < 60; i++) budget.enter('one')!();
  expect(budget.enter('one')).toBeUndefined();
  for (let i = 0; i < 59; i++) budget.enter('different-' + i)!();
  expect(budget.enter('last')).toBeUndefined(); now = 60000; expect(budget.enter('one')).toBeDefined();
});
