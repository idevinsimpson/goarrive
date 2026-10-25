import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useSessionServerTime } from '../useSessionServerTime';
const m = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
let root: Root, host: HTMLDivElement;
function Screen({ id = 'direct' }: { id?: string }) { const { now } = useSessionServerTime(id, 'member'); return <div>{now === null ? 'pending' : now}</div>; }
const render = (id = 'direct') => act(async () => root.render(<Screen id={id} />));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  m.call.mockResolvedValue({ data: { serverNow: 100000 } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([-1800000, 1800000])('direct route and reload obtain server time despite skew %s', async skew => {
  vi.setSystemTime(100000 + skew); await render(); expect(host.textContent).toBe('100000');
  expect(m.call).toHaveBeenCalledWith({ sessionInstanceId: 'direct' });
  await act(async () => root.unmount()); root = createRoot(host); await render(); expect(host.textContent).toBe('100000');
});
it('does not use a response for a previous route', async () => {
  let release!: (value: any) => void; m.call.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await render('old'); await render('new'); await act(async () => release({ data: { serverNow: 999999 } }));
  expect(host.textContent).toBe('100000');
});
it('fails closed when observations expire, without falling back to device time', async () => {
  await render(); m.call.mockReturnValue(new Promise(() => {}));
  await act(async () => { await vi.advanceTimersByTimeAsync(62000); });
  expect(host.textContent).toBe('pending');
});
it('rejects a slow initial server response', async () => {
  let release!: (value: any) => void; m.call.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(11000); release({ data: { serverNow: 100000 } }); });
  expect(host.textContent).toBe('pending');
});
