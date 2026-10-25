import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Screen from '../../app/live-session/[sessionInstanceId]';
const m = vi.hoisted(() => ({ user: { uid: 'member' } as any, params: { sessionInstanceId: 'one', openWorkout: '1' }, now: Date.parse('2026-10-25T14:00Z'), snapshot: {} as any, call: vi.fn(), player: null as any }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => m.params, useRouter: () => ({ replace: vi.fn() }), Redirect: () => <div>Login</div> }));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({ user: m.user, loading: false }) }));
vi.mock('../../lib/firebase', () => ({ functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => m.call }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), onSnapshot: (_: any, next: any) => { next({ exists: () => true, id: m.params.sessionInstanceId, data: () => m.snapshot }); return () => {}; } }));
vi.mock('../../hooks/useSessionServerTime', () => ({ useSessionServerTime: () => ({ now: m.now, refreshTime: vi.fn() }) }));
vi.mock('../../components/WorkoutPlayer', () => ({ default: (props: any) => { m.player = props; return <div data-player="true" />; } }));
vi.mock('../../components/WorkoutVideoOverlay', () => ({ default: () => null }));
vi.mock('../../components/SessionZoomTile', () => ({ default: () => null }));
vi.mock('../../components/RecordedSessionVideoEntry', () => ({ default: () => null }));
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<Screen />));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); m.user = { uid: 'member' }; m.player = null;
  m.params = { sessionInstanceId: 'one', openWorkout: '1' }; m.now = Date.parse('2026-10-25T14:00Z');
  m.snapshot = { status: 'allocated', startUtc: { seconds: m.now / 1000 }, durationMinutes: 45, timezone: 'America/New_York', scheduledDate: '2026-10-25', scheduledStartTime: '10:00', scheduledEndTime: '10:45' };
  m.call.mockResolvedValue({ data: { workout: { id: 'workout', name: 'Synthetic' } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('opens resolved eligible workout once without starting Zoom or completing', async () => {
  await render(); expect(host.querySelector('[data-player]')).not.toBeNull(); expect(m.call).toHaveBeenCalledTimes(1);
  await act(async () => m.player.onClose()); await render(); expect(host.querySelector('[data-player]')).toBeNull(); expect(m.call).toHaveBeenCalledTimes(1);
});
it.each(['cancelled', 'missed', 'skipped'])('never auto-opens %s session', async status => {
  m.snapshot.status = status; await render(); expect(host.querySelector('[data-player]')).toBeNull();
});
it('does not auto-open before eligibility or after workout completion', async () => {
  m.snapshot.startUtc = { seconds: (m.now + 3600000) / 1000 }; await render(); expect(host.querySelector('[data-player]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
it('does not auto-open failed workout resolution', async () => {
  m.call.mockRejectedValueOnce(new Error('synthetic')); await render(); expect(host.querySelector('[data-player]')).toBeNull(); expect(host.textContent).toContain('Workout could not load');
});
it('does not bypass sign-in', async () => {
  m.user = null; await render(); expect(host.querySelector('[data-player]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
