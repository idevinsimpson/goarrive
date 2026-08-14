import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedHooks = new Set<() => void>();

afterEach(() => {
  for (const unmount of [...mountedHooks]) unmount();
});

export function renderHook(callback: () => unknown) {
  const container = document.createElement('div');
  const root = createRoot(container);
  let mounted = true;

  function HookHarness() {
    callback();
    return null;
  }

  act(() => {
    root.render(createElement(HookHarness));
  });

  function unmount() {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
    mountedHooks.delete(unmount);
  }

  mountedHooks.add(unmount);
  return { unmount };
}
