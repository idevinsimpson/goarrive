import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), call: vi.fn() }));
vi.mock('./firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, collection: string, id: string) => collection + '/' + id, getDoc: mocks.read, updateDoc: mocks.update }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }));
import { updateRosterArchive } from './updateRosterArchive';
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue(undefined); mocks.call.mockResolvedValue({}); });
it('keeps legacy plan writes unchanged', async () => {
  mocks.read.mockResolvedValue({ data: () => ({}) }); const patch = { isArchived: true };
  await updateRosterArchive('plan', patch); expect(mocks.update).toHaveBeenCalledWith('members/plan', patch); expect(mocks.call).not.toHaveBeenCalled();
});
it('uses only server membership transaction for locked plans', async () => {
  mocks.read.mockResolvedValue({ data: () => ({ guestIdentityLocked: true }) });
  await updateRosterArchive('plan', { isArchived: true, name: 'untrusted' });
  expect(mocks.call).toHaveBeenCalledWith({ memberId: 'plan', isArchived: true }); expect(mocks.update).not.toHaveBeenCalled();
});
it('does not fall back to direct writes after server rejection', async () => {
  mocks.read.mockResolvedValue({ data: () => ({ guestIdentityLocked: true }) }); mocks.call.mockRejectedValue(new Error('denied'));
  await expect(updateRosterArchive('plan', { isArchived: true })).rejects.toThrow('denied'); expect(mocks.update).not.toHaveBeenCalled();
});
