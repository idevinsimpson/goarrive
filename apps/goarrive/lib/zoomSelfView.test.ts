import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { watchZoomSelfView } from './zoomSelfView';
let root: HTMLDivElement, frames: Map<number, FrameRequestCallback>, seq: number;
let observer: ResizeObserverCallback;
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(0)); };
beforeEach(() => {
  seq = 0; frames = new Map(); root = document.createElement('div'); document.body.appendChild(root);
  root.getClientRects = () => [1] as any;
  root.getBoundingClientRect = () => ({ width: 320, height: 240 }) as DOMRect;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++seq, fn); return seq; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(fn: ResizeObserverCallback) { observer = fn; } observe() {} disconnect() {} });
});
afterEach(() => { root.remove(); vi.unstubAllGlobals(); });
const setup = () => {
  let listener: () => void = () => {};
  const user = { video: false, isVideoConnect: true };
  const client = { getCurrentUser: () => user, on: vi.fn((_event, fn) => { listener = fn; }), off: vi.fn(), updateVideoOptions: vi.fn() };
  const report = vi.fn(); const view = watchZoomSelfView(client, root, report);
  return { user, client, report, view, updated: () => listener() };
};
it('redraws existing client after join and camera start without changing media', () => {
  const h = setup(); flush(); expect(h.client.updateVideoOptions).toHaveBeenCalledWith({ viewSizes: { default: { width: 320, height: 240 } } });
  expect(h.report).toHaveBeenLastCalledWith(false);
  h.user.video = true; h.updated(); flush(); expect(h.report).toHaveBeenLastCalledWith(true); expect(h.client.updateVideoOptions).toHaveBeenCalledTimes(2);
  h.updated(); flush(); expect(h.client.updateVideoOptions).toHaveBeenCalledTimes(2); h.view.close();
});
it('coalesces recovery, ignores hidden view and redraws after restore/resize', () => {
  const h = setup(); root.getClientRects = () => [] as any; flush(); expect(h.client.updateVideoOptions).not.toHaveBeenCalled();
  root.getClientRects = () => [1] as any; h.view.refresh(); h.view.refresh(); flush(); expect(h.client.updateVideoOptions).toHaveBeenCalledTimes(1);
  root.getBoundingClientRect = () => ({ width: 640, height: 420 }) as DOMRect; observer([], {} as ResizeObserver); flush();
  expect(h.client.updateVideoOptions).toHaveBeenLastCalledWith({ viewSizes: { default: { width: 640, height: 420 } } }); h.view.close();
});
it('late events and queued redraw cannot touch a closed or replacement client', () => {
  const h = setup(); h.view.close(); h.user.video = true; h.updated(); h.view.refresh(); flush();
  expect(h.client.updateVideoOptions).not.toHaveBeenCalled(); expect(h.client.off).toHaveBeenCalledWith('user-updated', expect.any(Function));
});
it('SDK redraw failure is contained without recreating or joining', () => {
  const h = setup(); h.client.updateVideoOptions.mockImplementation(() => { throw Error('synthetic'); }); expect(flush).not.toThrow(); h.view.close();
});
