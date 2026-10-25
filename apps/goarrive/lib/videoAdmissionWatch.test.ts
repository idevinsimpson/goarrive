import { afterEach, expect, it, vi } from 'vitest';
import { watchVideoAdmission } from './videoAdmissionWatch';
afterEach(() => vi.useRealTimers());
it('does not overlap slow checks and expires old admission independently', async () => {
  vi.useFakeTimers(); let resolve!: (value: boolean) => void;
  const read = vi.fn().mockResolvedValueOnce(true).mockImplementation(() => new Promise<boolean>(r => { resolve = r; }));
  const accept = vi.fn(), deny = vi.fn(); const stop = watchVideoAdmission(read, accept, deny);
  await vi.advanceTimersByTimeAsync(15000); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10000); expect(deny).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000); expect(read).toHaveBeenCalledTimes(2);
  stop(); resolve(true); await Promise.resolve(); expect(accept).toHaveBeenCalledTimes(1);
});
it('denies failed revalidation without capturing media', async () => {
  vi.useFakeTimers(); const deny = vi.fn(); const accept = vi.fn();
  const stop = watchVideoAdmission(() => Promise.reject(new Error('offline')), accept, deny);
  await vi.advanceTimersByTimeAsync(0); expect(deny).toHaveBeenCalledOnce(); stop();
  await vi.advanceTimersByTimeAsync(60000); expect(accept).not.toHaveBeenCalled();
});

it('closes at the server-provided end deadline before the next periodic check', async () => {
  vi.useFakeTimers(); const deny = vi.fn(); const stop = watchVideoAdmission(async () => ({ remaining: 1000 }), vi.fn(), deny, 15000, 25000, value => value.remaining);
  await vi.advanceTimersByTimeAsync(1000); expect(deny).toHaveBeenCalledOnce(); stop();
});
