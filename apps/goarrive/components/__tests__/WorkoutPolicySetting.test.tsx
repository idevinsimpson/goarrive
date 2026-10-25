import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkoutPolicySetting from '../WorkoutPolicySetting';
const m = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
let root: Root, host: HTMLDivElement;
const render = (policy?: string, id = 'plan') => act(async () => root.render(<WorkoutPolicySetting playbookId={id} policy={policy} />));
async function click(text: string) { await act(async () => { [...host.querySelectorAll('[role="radio"], [role="button"]')].find(el => el.textContent?.includes(text))?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); m.call.mockResolvedValue({ data: { policy: 'scheduled' } }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('legacy defaults to carry and requires an explicit save for scheduled mode', async () => {
  await render(); expect(host.textContent).toContain('● Carry unfinished workouts forward');
  await click('Follow the scheduled'); expect(m.call).not.toHaveBeenCalled();
  await click('Save workout setting'); expect(m.call).toHaveBeenCalledWith({ playbookId: 'plan', policy: 'scheduled' });
});
it('shows failed saves and supports retry without changing the stored choice', async () => {
  m.call.mockRejectedValueOnce(new Error('offline')); await render(); await click('Follow the scheduled'); await click('Save workout setting');
  expect(host.textContent).toContain('Unable to save'); await click('Save workout setting'); expect(m.call).toHaveBeenCalledTimes(2);
});
it('ignores an old failed save after changing Playbook', async () => {
  let reject!: (e: Error) => void; m.call.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  await render(); await click('Follow the scheduled'); await click('Save workout setting'); await render('carry_forward', 'new-plan');
  await act(async () => reject(new Error('old'))); expect(host.textContent).not.toContain('Unable to save');
  expect(host.textContent).toContain('● Carry unfinished workouts forward');
});
