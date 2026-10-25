import { it, expect, vi, afterEach } from 'vitest';
import { GuestMediaClient } from './guestMediaClient';
const revision = 'a'.repeat(64), manifest = () => new Response(JSON.stringify({ revision, serverNow: 0, validUntil: 25000 }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps capability out of URL/body and uses private same-origin transport', async () => {
  const fetcher = vi.fn(async () => manifest()), client = new GuestMediaClient('synthetic', fetcher);
  await client.manifest(); const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/guest-workout-api/manifest'); expect(init.body).not.toContain('synthetic');
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'same-origin' }); client.close();
});
it('single-flight renewal cannot extend expired admission while response hangs', async () => {
  vi.useFakeTimers(); let finish!: (r: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(manifest()).mockImplementation(() => new Promise(r => { finish = r; }));
  const closed = vi.fn(), client = new GuestMediaClient('synthetic', fetcher, () => Date.now(), closed);
  await client.manifest(); const pending = client.manifest(); expect(client.manifest()).toBe(pending);
  await vi.advanceTimersByTimeAsync(25001); expect(closed).toHaveBeenCalledTimes(1);
  finish(manifest()); await expect(pending).rejects.toThrow('Workout unavailable');
});
it('range blobs revoke on close and duplicate close is safe', async () => {
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic'), revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValueOnce(manifest()).mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { 'Content-Range': 'bytes 0-0/2', 'Content-Type': 'video/mp4' } })).mockResolvedValueOnce(new Response(new Uint8Array([2]), { headers: { 'Content-Range': 'bytes 1-1/2', 'Content-Type': 'video/mp4' } }));
  const client = new GuestMediaClient('synthetic', fetcher); await client.manifest(); expect(await client.asset('asset-0')).toBe('blob:synthetic');
  expect(created).toHaveBeenCalledTimes(1); client.close(); client.close(); expect(revoked).toHaveBeenCalledTimes(1);
});
it('rejects oversized or HTML asset metadata and late responses after close', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(manifest()).mockResolvedValueOnce(new Response('x', { headers: { 'Content-Range': 'bytes 0-0/999999999', 'Content-Type': 'text/html' } }));
  const client = new GuestMediaClient('synthetic', fetcher); await client.manifest(); await expect(client.asset('asset-0')).rejects.toThrow('Workout unavailable');
  await expect(client.manifest()).rejects.toThrow('Workout unavailable');
});
