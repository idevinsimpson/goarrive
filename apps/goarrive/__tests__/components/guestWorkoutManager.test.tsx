import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, collection: string, id: string) => collection + '/' + id, getDoc: mocks.read }));
vi.mock('firebase/functions', () => ({ httpsCallable: (_: unknown, name: string) => (data: unknown) => mocks.call(name, data) }));
import Manager from '../../components/GuestWorkoutLinkManager';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.read.mockImplementation(async (path: string) => ({ data: () => path.startsWith('playbooks/') ? { memberIds: ['one', 'two'] } : { name: path.endsWith('one') ? 'Synthetic one' : 'Synthetic two' } }));
  mocks.call.mockResolvedValue({ data: { canIssue: false } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => { root.render(<Manager playbookId="plan" onClose={() => {}} />); });
const click = (role: string, text?: string) => act(async () => {
  const node = [...document.body.querySelectorAll(`[role="${role}"]`)].find(n => !text || n.textContent?.includes(text)) as HTMLElement;
  expect(node).toBeTruthy(); node.click();
});
it('wired panel never issues on mount and permits selected-member revocation while release is off', async () => {
  await render(); expect(document.body.textContent).toContain('not available yet');
  await click('checkbox'); await click('button', 'Create or replace guest link');
  expect(mocks.call.mock.calls.filter(c => c[0] === 'issueGuestWorkoutLink')).toHaveLength(0);
  await click('button', 'Disable guest access');
  expect(mocks.call).toHaveBeenCalledWith('revokeGuestWorkoutLink', { playbookId: 'plan', memberId: 'one' });
});
it('confirmation creates only selected assignment and clears one-time link on selection/pagehide', async () => {
  mocks.call.mockImplementation(async name => ({ data: name === 'getGuestWorkoutAccess' ? { canIssue: true } : { token: 'a'.repeat(43) } }));
  await render(); await click('checkbox'); await click('button', 'Create or replace guest link');
  expect(mocks.call).toHaveBeenCalledWith('issueGuestWorkoutLink', expect.objectContaining({ playbookId: 'plan', memberId: 'one', confirmed: true }));
  expect(document.body.textContent).toContain('/guest-workout#key=');
  await click('radio', 'Synthetic two'); expect(document.body.textContent).not.toContain('/guest-workout#key=');
  await click('checkbox'); await click('button', 'Create or replace guest link');
  await act(async () => window.dispatchEvent(new Event('pagehide'))); expect(document.body.textContent).not.toContain('/guest-workout#key=');
});
it('delayed issuance result does not appear under another selected member', async () => {
  let resolve!: (value: unknown) => void;
  mocks.call.mockImplementation(name => name === 'getGuestWorkoutAccess' ? Promise.resolve({ data: { canIssue: true } }) : new Promise(r => { resolve = r; }));
  await render(); await click('checkbox'); await click('button', 'Create or replace guest link');
  await click('radio', 'Synthetic two'); await act(async () => resolve({ data: { token: 'b'.repeat(43) } }));
  expect(document.body.textContent).not.toContain('/guest-workout#key=');
});
