import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Screen from '../../app/playbook/[playbookId]';
const m = vi.hoisted(() => ({ auth: { user: { uid: 'member' } as any, loading: false }, params: { playbookId: 'plan' }, call: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => m.params, useRouter: () => ({ push: m.push, replace: m.replace }), Redirect: ({ href }: any) => <div data-redirect={JSON.stringify(href)} /> }));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => m.auth }));
vi.mock('../../lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
let root: Root, host: HTMLDivElement;
const now = Date.parse('2026-10-25T14:00Z');
const session = (id: string) => ({ id, scheduledDate: '2026-10-25', scheduledStartTime: '10:00', scheduledEndTime: '10:45', timezone: 'America/New_York', startUtc: { seconds: now / 1000 }, durationMinutes: 45, status: 'scheduled' });
const response = (sessions: Array<ReturnType<typeof session> & { workoutCompletedAt?: { seconds: number } }> = [session('one')]) => ({ data: { title: 'Test plan', serverNow: now, sessions } });
const render = () => act(async () => root.render(<Screen />));
const click = (label: string) => act(async () => { const button = [...host.querySelectorAll('[role="button"]')].find(b => b.textContent === label) as HTMLElement; expect(button).toBeTruthy(); button.click(); });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  m.auth = { user: { uid: 'member' }, loading: false }; m.params = { playbookId: 'plan' };
  m.call.mockResolvedValue(response());
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('preserves the stable destination through signed-out authentication without fetching', async () => {
  m.auth.user = null; await render();
  expect(host.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toContain('/playbook/plan');
  expect(m.call).not.toHaveBeenCalled();
});
it('rechecks ownership and cancellation before opening the existing player', async () => {
  m.call.mockResolvedValueOnce(response()).mockResolvedValueOnce(response([{ ...session('one'), status: 'cancelled' }]));
  await render(); expect(m.push).not.toHaveBeenCalled(); expect(m.replace).not.toHaveBeenCalled(); expect(host.textContent).toContain('schedule changed');
});
it('opens the current session after a fresh read without resolving or completing workouts itself', async () => {
  await render();
  expect(m.replace).toHaveBeenCalledWith('/live-session/one?openWorkout=1'); expect(m.call).toHaveBeenCalledTimes(2);
});
it('shows multiple sessions as a choice and does not navigate arbitrarily', async () => {
  m.call.mockResolvedValue(response([session('one'), session('two')])); await render();
  expect(host.textContent).toContain('Choose your session'); expect(m.push).not.toHaveBeenCalled();
  expect([...host.querySelectorAll('[role="button"]')].filter(b => b.textContent === 'Open current workout')).toHaveLength(2);
});
it('shows wrong-account feedback and supports retry after a failed load', async () => {
  m.call.mockRejectedValueOnce({ code: 'functions/permission-denied' }); await render();
  expect(host.textContent).toContain('not assigned to your account'); await click('Refresh schedule'); expect(host.textContent).toContain('Test plan');
});
it('discards a delayed response after account or route changes', async () => {
  let release!: (value: any) => void;
  m.call.mockReturnValueOnce(new Promise(resolve => { release = resolve; })); await render();
  m.auth.user = { uid: 'other' }; m.params = { playbookId: 'other-plan' }; m.call.mockRejectedValue({ code: 'functions/permission-denied' }); await render();
  await act(async () => release(response())); expect(host.textContent).not.toContain('Test plan'); expect(host.textContent).toContain('not assigned');
});
it('discards delayed open after navigating to a different Playbook', async () => {
  let release!: (value: any) => void;
  m.call.mockResolvedValueOnce(response()).mockReturnValueOnce(new Promise(resolve => { release = resolve; })); await render();
  m.params = { playbookId: 'other-plan' }; m.call.mockResolvedValue(response([])); await render(); await act(async () => release(response())); expect(m.replace).not.toHaveBeenCalled();
});
it('coalesces duplicate open clicks while fresh authorization is pending', async () => {
  m.call.mockResolvedValueOnce(response([session('one'), session('two')])); await render(); let release!: (value: any) => void;
  m.call.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await act(async () => {
    const button = [...host.querySelectorAll('[role="button"]')].find(b => b.textContent === 'Open current workout') as HTMLElement;
    button.click(); button.click();
  });
  expect(m.call).toHaveBeenCalledTimes(2);
  await act(async () => release(response())); expect(m.push).toHaveBeenCalledTimes(1);
});


it('does not auto-open when a fresh read introduces a second eligible session', async () => {
  m.call.mockResolvedValueOnce(response()).mockResolvedValue(response([session('one'), session('two')])); await render();
  expect(m.replace).not.toHaveBeenCalled(); expect(host.textContent).toContain('Choose your session');
});
it('does not auto-open an upcoming, ended or completed workout', async () => {
  m.call.mockResolvedValue(response([{ ...session('one'), workoutCompletedAt: { seconds: now / 1000 } }])); await render();
  expect(m.replace).not.toHaveBeenCalled(); expect(m.call).toHaveBeenCalledTimes(1);
});
