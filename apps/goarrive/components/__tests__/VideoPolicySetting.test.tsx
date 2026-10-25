import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VideoPolicySetting from '../VideoPolicySetting';
const m = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
let root: Root, host: HTMLDivElement;
const render = (kind: 'playbook' | 'workout') => act(async () => root.render(<VideoPolicySetting kind={kind} id="resource" />));
const click = (text: string) => act(async () => { [...host.querySelectorAll('[role="radio"], [role="button"]')].find(x => x.textContent?.includes(text))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); m.call.mockResolvedValue({ data: { saved: true } }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('defaults Playbook off and workout inherit, with no writes until explicit save', async () => {
  await render('playbook'); expect(host.querySelector('[aria-checked="true"]')?.textContent).toBe('Off');
  await render('workout'); expect(host.querySelector('[aria-checked="true"]')?.textContent).toBe('Use Playbook setting');
  await click('Allow member'); expect(m.call).not.toHaveBeenCalled(); await click('Save video');
  expect(m.call).toHaveBeenCalledWith({ kind: 'workout', id: 'resource', policy: 'on' });
});
it('shows failed save and permits retry without recording fields', async () => {
  m.call.mockRejectedValueOnce(new Error('offline')); await render('playbook'); await click('Allow member'); await click('Save video');
  expect(host.textContent).toContain('could not save'); await click('Save video');
  expect(m.call).toHaveBeenLastCalledWith({ kind: 'playbook', id: 'resource', policy: 'on' });
});
