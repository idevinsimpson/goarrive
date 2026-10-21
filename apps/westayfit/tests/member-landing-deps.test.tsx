import { describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-19 (RV16-641-B1). The deps member's Sign in and Create
 * account land with (src/ui/memberLanding.ts): landAfterAuth's own four, plus
 * the root stack's routes and a dismissTo, so its kiosk-beneath guard can see
 * a kiosk under them (proven on a real stack in
 * tests/kiosk-signin-landing-stack.test.tsx). Both screens use this one
 * builder, so they cannot drift.
 */

const router = { push: vi.fn(), replace: vi.fn(), dismissTo: vi.fn() };
vi.mock('expo-router', () => ({ router }));

const { memberLandingDeps } = await import('../src/ui/memberLanding');
const { Platform } = await import('react-native');

describe('W16-19: memberLandingDeps', () => {
  it('reads the root stack’s routes through the screen’s navigation object, at the landing', () => {
    let routes = [{ name: 'kiosk/[goalId]', params: { goalId: 'goal-1' } }, { name: 'signin' }];
    const deps = memberLandingDeps({ dispatch: () => undefined, getState: () => ({ routes }) });
    expect(deps.routes?.()).toBe(routes);
    routes = [{ name: 'kiosk/[goalId]', params: { goalId: 'goal-1' } }];
    expect(deps.routes?.()).toBe(routes);
    expect(memberLandingDeps({ dispatch: () => undefined, getState: () => undefined }).routes?.()).toBeUndefined();
  });

  it('dismisses through expo-router, and dispatches, pushes and replaces as before', () => {
    const dispatched: unknown[] = [];
    const deps = memberLandingDeps({ dispatch: (a) => dispatched.push(a), getState: () => undefined });
    deps.dismissTo?.('/kiosk/goal-1');
    expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/goal-1');
    deps.push('/join/x');
    deps.replace('/event/g');
    expect(router.push).toHaveBeenCalledWith('/join/x');
    expect(router.replace).toHaveBeenCalledWith('/event/g');
    deps.dispatch({ type: 'RESET' } as never);
    expect(dispatched).toEqual([{ type: 'RESET' }]);
    expect(deps.platform).toBe(Platform.OS);
  });

  it('both screens land through it', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of ['app/signin.tsx', 'app/signup.tsx']) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(src, file).toContain('landAfterAuth(next, memberLandingDeps(navigation))');
      expect(src.match(/landAfterAuth\(/g), file).toHaveLength(1);
    }
  });
});
