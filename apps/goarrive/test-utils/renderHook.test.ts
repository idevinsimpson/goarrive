import { useEffect, useState } from 'react';
import { expect, test, vi } from 'vitest';
import { act, renderHook } from './renderHook';

test('tracks result.current across prop rerenders and unmount cleanup', () => {
  const cleanup = vi.fn();
  const hook = renderHook(
    ({ value }: { value: number }) => {
      const [current, setCurrent] = useState(value);
      useEffect(() => {
        setCurrent(value);
        return cleanup;
      }, [value]);
      return current;
    },
    { initialProps: { value: 1 } },
  );

  expect(hook.result.current).toBe(1);
  act(() => hook.rerender({ value: 2 }));
  expect(hook.result.current).toBe(2);

  hook.unmount();
  expect(cleanup).toHaveBeenCalledTimes(2);
});
