import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SessionZoomTile from '../WorkoutVideoOverlay';
const m = vi.hoisted(() => ({ available: vi.fn(), config: vi.fn(), load: vi.fn(), init: vi.fn(), join: vi.fn(), leave: vi.fn(), destroy: vi.fn(), user: { uid: 'member' } as any, capture: vi.fn() }));
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
  m.load.mockResolvedValue({ createClient: () => ({ init: m.init, join: m.join, leaveMeeting: m.leave }), destroyClient: m.destroy });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('disabled and signed-out mounting never loads SDK, signs a join, or requests media', async () => {
  m.available.mockResolvedValue({ data: { enabled: false } }); await render();
  expect(m.load).not.toHaveBeenCalled(); expect(m.config).not.toHaveBeenCalled(); expect(m.capture).not.toHaveBeenCalled();
  m.user = null; await render('other'); expect(m.available).toHaveBeenCalledTimes(1);
});
it('enabled mounting still needs a member click; SDK controls own camera/microphone consent', async () => {
  await render(); expect(m.load).not.toHaveBeenCalled(); await click('Join video');
  expect(m.config).toHaveBeenCalledWith({ sessionInstanceId: 'session', purpose: 'workout_video' });
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
  await click('Minimize video'); expect(host.textContent).toContain('Video connected'); await click('Show video controls'); expect(m.join).toHaveBeenCalledOnce();
  await click('Leave video'); expect(m.destroy).toHaveBeenCalledOnce();
});
it('failed admission shows retry and does not load SDK or capture', async () => {
  m.config.mockRejectedValueOnce(new Error('offline')); await render(); await click('Join video');
  expect(host.textContent).toContain('Video could not connect'); expect(m.load).not.toHaveBeenCalled();
  await click('Retry video'); expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
  await click('Minimize video'); expect(host.textContent).toContain('Video connected'); await click('Show video controls'); expect(m.join).toHaveBeenCalledOnce();
  await click('Leave video');
});
it('navigation while join is pending cannot resurrect a previous meeting', async () => {
  let resolve!: () => void; m.join.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
  await render(); await click('Join video'); await render('new-session');
  await act(async () => { resolve(); });
  expect(m.destroy).toHaveBeenCalledOnce(); expect(m.leave).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('Leave video');
});

it('a changed server room/schedule binding closes the old client without another click', async () => {
  vi.useFakeTimers();
  m.available.mockResolvedValueOnce({ data: { enabled: true, validForMs: 25000, binding: 'original' } }).mockResolvedValue({ data: { enabled: true, validForMs: 25000, binding: 'replacement' } });
  await render(); await click('Join video');
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(m.destroy).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain('Leave video');
});

it('recorded admission discloses recording and needs its explicit consent click', async () => {
  m.available.mockResolvedValue({ data: { enabled: true, validForMs: 25000, recordingMode: 'cloud', binding: 'recorded-v1' } });
  await render(); expect(host.textContent).toContain('This session is cloud recorded');
  expect(m.config).not.toHaveBeenCalled(); expect(m.capture).not.toHaveBeenCalled();
  await click('Agree and join recorded video');
  expect(m.config).toHaveBeenCalledWith({ sessionInstanceId: 'session', purpose: 'workout_video', recordingConsentBinding: 'recorded-v1' });
  expect(m.join).toHaveBeenCalledOnce(); expect(m.capture).not.toHaveBeenCalled();
});

it('allows a slow SDK join beyond the network timeout without starting capture', async () => {
  vi.useFakeTimers(); let finish!: () => void;
  m.join.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await render(); await click('Join video');
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(m.leave).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Video could not connect');
  await act(async () => { finish(); });
  expect(host.textContent).toContain('Leave video'); expect(m.capture).not.toHaveBeenCalled();
});

it('shows a sanitized join code without exposing the raw provider error', async () => {
  m.join.mockRejectedValueOnce({ errorCode: 3000, message: 'PRIVATE_TOKEN' });
  await render(); await click('Join video');
  expect(host.textContent).toContain('joining Zoom (code 3000)');
  expect(host.textContent).not.toContain('PRIVATE_TOKEN'); expect(m.destroy).toHaveBeenCalledOnce();
});
