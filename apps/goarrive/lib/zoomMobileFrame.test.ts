import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = fs.readFileSync(path.resolve('public/workout-zoom-client.js'), 'utf8');
function harness() {
  const handlers: Record<string, Function> = {}, parent = { postMessage: vi.fn() }, scripts: string[] = [];
  const status = { textContent: '', style: { display: '' } };
  const sdk = { setZoomJSLib: vi.fn(), preLoadWasm: vi.fn(), prepareWebSDK: vi.fn(), init: vi.fn((o: any) => o.success()), join: vi.fn((o: any) => o.success()) };
  const window = { parent, location: { origin: 'https://goarrive.test' }, addEventListener: (name: string, fn: Function) => { handlers[name] = fn; }, ZoomMtg: sdk };
  vm.runInNewContext(source, { window, document: { getElementById: () => status, createElement: () => ({ remove() {} }), head: { appendChild: (el: any) => { scripts.push(el.src); el.onload(); } } }, setTimeout, clearTimeout });
  const join = (extra = {}) => handlers.message({ origin: 'https://goarrive.test', source: parent, data: { type: 'workout-zoom-join', config: { signature: 'synthetic', meetingNumber: '123', userName: 'Synthetic' } }, ...extra });
  return { handlers, parent, scripts, sdk, join };
}
it('loads no SDK until exact parent message, then initializes supported Client View without preview/capture automation', async () => {
  const h = harness(); expect(h.scripts).toEqual([]);
  await h.join({ origin: 'https://attacker.invalid' }); expect(h.scripts).toEqual([]);
  await h.join(); await h.join();
  expect(h.scripts).toHaveLength(6); expect(h.scripts[5]).toContain('zoom-meeting-5.1.4.min.js');
  expect(h.sdk.init).toHaveBeenCalledWith(expect.objectContaining({ disablePreview: true, enableWaitingRoomPreview: false, screenShare: false, debug: false }));
  expect(h.sdk.join).toHaveBeenCalledOnce(); expect(h.parent.postMessage).toHaveBeenCalledWith({ type: 'workout-zoom-joined' }, 'https://goarrive.test');
  expect(source).not.toMatch(/getUserMedia|localStorage|sessionStorage|console\./);
});
it('reports only numeric SDK errors and stops a late init after the frame unloads', async () => {
  const h = harness(); h.sdk.join.mockImplementationOnce((o: any) => o.error({ errorCode: 3000, message: 'PRIVATE_SENTINEL' }));
  await h.join(); expect(JSON.stringify(h.parent.postMessage.mock.calls)).not.toContain('PRIVATE_SENTINEL');
  expect(h.parent.postMessage).toHaveBeenCalledWith({ type: 'workout-zoom-error', code: 3000 }, 'https://goarrive.test');
  const second = harness(); second.sdk.init.mockImplementationOnce((o: any) => { second.handlers.pagehide(); o.success(); });
  await second.join(); expect(second.sdk.join).not.toHaveBeenCalled();
});
