import { afterEach, expect, it, vi } from 'vitest';
import { createMobileZoomClient, needsMobileZoomClient } from './zoomMobileClient';
afterEach(() => { document.body.innerHTML = ''; });
it('selects Client View for iPhone, Android and touch iPad but not desktop', () => {
  for (const userAgent of ['iPhone', 'Android', 'iPad']) expect(needsMobileZoomClient({ userAgent, platform: '', maxTouchPoints: 1 } as Navigator)).toBe(true);
  expect(needsMobileZoomClient({ userAgent: 'Safari', platform: 'MacIntel', maxTouchPoints: 5 } as Navigator)).toBe(true);
  expect(needsMobileZoomClient({ userAgent: 'Chrome', platform: 'Win32', maxTouchPoints: 0 } as Navigator)).toBe(false);
});
it('uses a credential-free same-origin frame and only accepts messages from that frame', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const ended = vi.fn(), owner = createMobileZoomClient(root, ended), frame = root.querySelector('iframe')!;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  const joining = owner.client.join({ signature: 'synthetic-private', meetingNumber: '123', userName: 'Synthetic', password: 'synthetic-pass' });
  const event = (source: Window | null, origin: string, type: string) => window.dispatchEvent(new MessageEvent('message', { source, origin, data: { type } }));
  event(window, window.location.origin, 'workout-zoom-ready');
  event(frame.contentWindow, 'https://wrong.invalid', 'workout-zoom-ready');
  await Promise.resolve(); expect(send).not.toHaveBeenCalled();
  event(frame.contentWindow, window.location.origin, 'workout-zoom-ready'); await Promise.resolve();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'workout-zoom-join' }), window.location.origin);
  expect(frame.src).not.toMatch(/synthetic|signature|password/); expect(frame.referrerPolicy).toBe('no-referrer');
  event(frame.contentWindow, window.location.origin, 'workout-zoom-joined'); await joining;
  owner.destroy(); expect(root.querySelector('iframe')).toBeNull(); expect(ended).not.toHaveBeenCalled();
});
it('destroy before iframe ready rejects pending join and cannot send credentials later', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const owner = createMobileZoomClient(root, vi.fn()), frame = root.querySelector('iframe')!;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  const pending = owner.client.join({ signature: 'synthetic', meetingNumber: '123' });
  const rejected = expect(pending).rejects.toThrow('closed'); owner.destroy(); await rejected;
  expect(send).not.toHaveBeenCalled(); owner.destroy();
});
