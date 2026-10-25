import { describe, expect, it, vi } from 'vitest';
import { createZoomLease } from './zoomClientLifecycle';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; };
describe('video lease', () => {
  it('cancels a delayed join, leaves again after resolution, and prevents another client racing teardown', async () => {
    const join = deferred(); const leaveMeeting = vi.fn().mockResolvedValue(undefined); const destroy = vi.fn();
    const lease = createZoomLease(() => ({ client: { leaveMeeting }, destroy })); const mounted = vi.fn();
    const run = lease.run(async current => { await join.promise; if (current()) mounted(); });
    const closing = lease.close();
    expect(() => createZoomLease(() => ({ client: {}, destroy: () => {} }))).toThrow(/still closing/);
    join.resolve(); await run; await closing;
    expect(mounted).not.toHaveBeenCalled(); expect(leaveMeeting).toHaveBeenCalledTimes(2); expect(destroy).toHaveBeenCalledOnce();
    const next = createZoomLease(() => ({ client: {}, destroy: () => {} })); await next.close();
  });
  it('handles rejected join/leave and repeated close without duplicate destruction', async () => {
    const destroy = vi.fn(); const lease = createZoomLease(() => ({ client: { leaveMeeting: vi.fn().mockRejectedValue(new Error('left')) }, destroy }));
    await expect(lease.run(async () => { throw new Error('join failed'); })).rejects.toThrow('join failed');
    await Promise.all([lease.close(), lease.close()]); expect(destroy).toHaveBeenCalledOnce();
  });
});
