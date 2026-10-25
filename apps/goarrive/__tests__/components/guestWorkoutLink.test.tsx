import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Controls from '../../components/GuestWorkoutLinkControls';
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (props: Partial<React.ComponentProps<typeof Controls>> = {}) => act(async () => root.render(<Controls assignmentKey="one" memberLabel="Synthetic member" {...props} />));
const click = async (role: string, label?: string) => act(async () => { const el = [...host.querySelectorAll(`[role="${role}"]`)].find(x => !label || x.textContent === label) as HTMLElement; expect(el).toBeTruthy(); el.click(); });
it('defaults unavailable and distinguishes authenticated permanent from guest link', async () => {
  const callback = vi.fn(); await render({ onConfirm: callback });
  expect(host.textContent).toContain('requires sign-in'); expect(host.textContent).toContain('not available yet');
  await click('checkbox'); await click('button', 'Create or replace guest link'); expect(callback).not.toHaveBeenCalled();
});
it('requires explicit confirmation before issuing; never issues on mount', async () => {
  const callback = vi.fn().mockResolvedValue(undefined); await render({ available: true, onConfirm: callback });
  await click('button', 'Create or replace guest link'); expect(callback).not.toHaveBeenCalled();
  await click('checkbox'); await click('button', 'Create or replace guest link'); expect(callback).toHaveBeenCalledExactlyOnceWith('replace');
  expect(host.textContent).toContain('cannot be retrieved later');
});
it('allows revocation without re-consenting to issuance', async () => {
  const callback = vi.fn().mockResolvedValue(undefined); await render({ available: false, canRevoke: true, onConfirm: callback });
  await click('button', 'Disable guest access'); expect(callback).toHaveBeenCalledExactlyOnceWith('revoke');
});
it('shows failure without leaking the underlying error and permits retry', async () => {
  const callback = vi.fn().mockRejectedValueOnce(new Error('SENSITIVE_SYNTHETIC')).mockResolvedValue(undefined);
  await render({ available: true, onConfirm: callback }); await click('checkbox'); await click('button', 'Create or replace guest link');
  expect(host.textContent).toContain('Please retry'); expect(host.textContent).not.toContain('SENSITIVE_SYNTHETIC');
  await click('button', 'Create or replace guest link'); expect(callback).toHaveBeenCalledTimes(2);
});
it('blocks duplicate clicks and ignores pending result after assignment changes', async () => {
  let release!: () => void; const callback = vi.fn(() => new Promise<void>(r => { release = r; }));
  await render({ available: true, onConfirm: callback }); await click('checkbox');
  await click('button', 'Create or replace guest link'); await click('button', 'Create or replace guest link'); expect(callback).toHaveBeenCalledTimes(1);
  await render({ assignmentKey: 'two', available: true, onConfirm: callback }); await act(async () => release());
  expect(host.textContent).not.toContain('Link created'); expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('false');
});
