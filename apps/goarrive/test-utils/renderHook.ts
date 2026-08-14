import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';

export { act };

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedHooks = new Set<() => void>();

afterEach(() => {
  for (const unmount of [...mountedHooks]) unmount();
});

export function renderHook<Result, Props = undefined>(
  callback: (props: Props) => Result,
  options: { initialProps?: Props } = {},
) {
  const container = document.createElement('div');
  const root = createRoot(container);
  let mounted = true;
  let props = options.initialProps as Props;
  let current: Result;

  function HookHarness({ hookProps }: { hookProps: Props }) {
    current = callback(hookProps);
    return null;
  }

  function render() {
    root.render(createElement(HookHarness, { hookProps: props }));
  }

  act(render);

  function rerender(nextProps: Props) {
    props = nextProps;
    act(render);
  }

  function unmount() {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
    mountedHooks.delete(unmount);
  }

  mountedHooks.add(unmount);
  return {
    result: { get current() { return current; } },
    rerender,
    unmount,
  };
}
