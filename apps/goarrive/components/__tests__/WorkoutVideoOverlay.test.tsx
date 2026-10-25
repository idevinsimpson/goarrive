import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SessionZoomTile from '../WorkoutVideoOverlay';
const m = vi.hoisted(() => ({ available: vi.fn(), config: vi.fn(), load: vi.fn(), init: vi.fn(), join: vi.fn(), leave: vi.fn(), destroy: vi.fn(), user: { uid: 'member' } as any, capture: vi.fn(), redraw: vi.fn() }));
vi.mock('react-native', async importOriginal => ({ ...await importOriginal<any>(), useWindowDimensions: () => ({ width: 430, height: 932, scale: 1, fontScale: 1 }) }));
vi.mock('../../lib/firebase', () => ({ functions: {} }));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_: any, name: string) => name === 'getSessionVideoAvailability' ? m.available : m.config }));
vi.mock('../../lib/zoomEmbeddedLoader', () => ({ loadZoomEmbedded: m.load }));
let root: Root, host: HTMLDivElement;
const render = (id = 'session') => act(async () => root.render(<SessionZoomTile sessionInstanceId={id} variant="pip" />));
const click = (text: string) => act(async () => { [...host.querySelectorAll('[role="button"]')].find(x => x.textContent?.includes(text))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); m.user = { uid: 'member' };
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: m.capture } });
  m.available.mockResolvedValue({ data: { enabled: true, validForMs: 25000 } }); m.config.mockResolvedValue({ data: { signature: 'synthetic', meetingNumber: 'synthetic' } });
  m.init.mockResolvedValue(undefined); m.join.mockResolvedValue(undefined); m.leave.mockResolvedValue(undefined);
  m.load.mockResolvedValue({ createClient: () => ({ init: m.init, join: m.join, leaveMeeting: m.leave, updateVideoOptions: m.redraw }), destroyClient: m.destroy });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('disabled and signed-out mounting never loads SDK, signs a join, or requests media', async () => {
  m.available.mockResolvedValue({ data: { enabled: false } }); await render();
  expect(m.load).not.toHaveBeenCalled(); expect(m.config).not.toHaveBeenCalled(); expect(m.capture).not.toHaveBeenCalled();
  m.user = null; await render('other'); expect(m.available).toHaveBeenCalledTimes(1);
});
it('enabled mounting still needs a member click; SDK controls own camera/microphone consent', async () => {
  await render(); expect(m.load).not.toHaveBeenCalled(); await click('Camera');
  expect(m.config).toHaveBeenCalledWith({ sessionInstanceId: 'session', purpose: 'workout_video' });
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
  await click('Small view'); expect(host.textContent).toContain('Expand'); await click('Expand'); expect(m.join).toHaveBeenCalledOnce();
  await click('Leave video'); expect(m.destroy).toHaveBeenCalledOnce();
});
it('failed admission shows retry and does not load SDK or capture', async () => {
  m.config.mockRejectedValueOnce(new Error('offline')); await render(); await click('Camera');
  expect(host.textContent).toContain('Video could not connect'); expect(m.load).not.toHaveBeenCalled();
  await click('Retry video'); expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
  await click('Small view'); expect(host.textContent).toContain('Expand'); await click('Expand'); expect(m.join).toHaveBeenCalledOnce();
  await click('Leave video');
});
it('navigation while join is pending cannot resurrect a previous meeting', async () => {
  let resolve!: () => void; m.join.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
  await render(); await click('Camera'); await render('new-session');
  await act(async () => { resolve(); });
  expect(m.destroy).toHaveBeenCalledOnce(); expect(m.leave).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('Leave video');
});

it('a changed server room/schedule binding closes the old client without another click', async () => {
  vi.useFakeTimers();
  m.available.mockResolvedValueOnce({ data: { enabled: true, validForMs: 25000, binding: 'original' } }).mockResolvedValue({ data: { enabled: true, validForMs: 25000, binding: 'replacement' } });
  await render(); await click('Camera');
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(m.destroy).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('Leave video');
});

it('recorded admission discloses recording and needs its explicit consent click', async () => {
  m.available.mockResolvedValue({ data: { enabled: true, validForMs: 25000, recordingMode: 'cloud', binding: 'recorded-v1' } });
  await render(); await click('Camera'); expect(host.textContent).toContain('Cloud recording');
  expect(m.config).not.toHaveBeenCalled(); expect(m.capture).not.toHaveBeenCalled();
  await click('Agree and join recorded video');
  expect(m.config).toHaveBeenCalledWith({ sessionInstanceId: 'session', purpose: 'workout_video', recordingConsentBinding: 'recorded-v1' });
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
});

it('allows a slow SDK join beyond the network timeout without starting capture', async () => {
  vi.useFakeTimers(); let finish!: () => void;
  m.join.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await render(); await click('Camera');
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(m.leave).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Video could not connect');
  await act(async () => { finish(); });
  expect(host.textContent).toContain('Leave video'); expect(m.capture).not.toHaveBeenCalled();
});

it('shows a sanitized join code without exposing the raw provider error', async () => {
  m.join.mockRejectedValueOnce({ errorCode: 3000, message: 'PRIVATE_TOKEN' });
  await render(); await click('Camera');
  expect(host.textContent).toContain('joining Zoom (code 3000)');
  expect(host.textContent).not.toContain('PRIVATE_TOKEN'); expect(m.destroy).toHaveBeenCalledOnce();
});


it('refreshes only the existing view and cancels a queued refresh on leave', async () => {
  vi.useFakeTimers();
  m.init.mockImplementation(async ({ zoomAppRoot }) => {
    zoomAppRoot.getClientRects = () => [1];
    zoomAppRoot.getBoundingClientRect = () => ({ width: 320, height: 240 });
  });
  await render(); await click('Camera');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  const initial = m.redraw.mock.calls.length; expect(initial).toBeGreaterThan(0);
  await click('Refresh video view');
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(m.redraw.mock.calls.length).toBeGreaterThan(initial);
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
  await click('Refresh video view'); await click('Leave video');
  const stopped = m.redraw.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(m.redraw).toHaveBeenCalledTimes(stopped); expect(m.destroy).toHaveBeenCalledOnce();
});


it('small view keeps the SDK root rendered and expands without rejoining or capture', async () => {
  await render(); await click('Camera'); const sdkRoot = m.init.mock.calls[0][0].zoomAppRoot as HTMLElement;
  await click('Small view');
  expect(sdkRoot.isConnected).toBe(true); expect(sdkRoot.style.display).toBe('block'); expect(sdkRoot.style.zoom).toBe('0.45');
  expect(sdkRoot.hasAttribute('inert')).toBe(true);
  await click('Expand'); expect(Number(sdkRoot.style.zoom)).toBeGreaterThan(0.45); expect(sdkRoot.hasAttribute('inert')).toBe(false);
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
});
it('does not auto-shrink merely because a join resolves', async () => {
  await render(); await click('Camera');
  expect(host.textContent).toContain('Small view'); expect(host.textContent).not.toContain('Expand');
});

it('magnifies the complete SDK root rather than resizing only its video canvas', async () => {
  await render(); await click('Camera');
  const sdkRoot = m.init.mock.calls[0][0].zoomAppRoot as HTMLElement;
  expect(sdkRoot.style.width).toBe('320px');
  expect(sdkRoot.style.transform).toBe('');
  expect(Number(sdkRoot.style.zoom)).toBeGreaterThan(1);
  expect(Number(sdkRoot.style.zoom)).toBeLessThanOrEqual(1.5);
  expect(sdkRoot.parentElement!.style.overflow).not.toBe('hidden');
});
it('compacts once after six seconds of camera-on and permits lasting manual expansion', async () => {
  vi.useFakeTimers();
  m.load.mockResolvedValue({ createClient: () => ({ init: m.init, join: m.join, leaveMeeting: m.leave, getCurrentUser: () => ({ video: true }) }), destroyClient: m.destroy });
  await render(); await click('Camera');
  await act(async () => { await vi.advanceTimersByTimeAsync(5999); });
  expect(host.textContent).toContain('Small view');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.textContent).toContain('Expand');
  await click('Expand');
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(host.textContent).toContain('Small view');
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
});

it('manual size choice cancels a pending automatic compact action', async () => {
  vi.useFakeTimers();
  m.load.mockResolvedValue({ createClient: () => ({ init: m.init, join: m.join, leaveMeeting: m.leave, getCurrentUser: () => ({ video: true }) }), destroyClient: m.destroy });
  await render(); await click('Camera'); await click('Small view'); await click('Expand');
  await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
  expect(host.textContent).toContain('Small view');
});

it('camera-off cancels pending compact and navigation does not compact the next session', async () => {
  vi.useFakeTimers(); let camera = true; let update: (() => void) | undefined;
  m.load.mockResolvedValue({ createClient: () => ({ init: m.init, join: m.join, leaveMeeting: m.leave, getCurrentUser: () => ({ video: camera }), on: (_: string, fn: () => void) => { update = fn; }, off: () => { update = undefined; } }), destroyClient: m.destroy });
  await render(); await click('Camera');
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); camera = false; update?.(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(host.textContent).toContain('Small view');
  await act(async () => { camera = true; update?.(); });
  await render('next-session');
  await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
  expect(host.textContent).not.toContain('Expand');
  expect(m.capture).not.toHaveBeenCalled();
});
