import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MovementKey } from '../src/movementSelection';
import { MovementPicker } from '../src/ui/MovementPicker';

/**
 * The picker rendered into jsdom through react-native-web: roles, checked
 * state, the explicit Something else choice and Space activation. What a
 * selection means is tested in movement-selection.test.ts.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function render(props: Partial<Parameters<typeof MovementPicker>[0]> & { selected: MovementKey[] }) {
  const onChange = vi.fn();
  act(() => {
    root.render(<MovementPicker onChange={onChange} testID="p" {...props} />);
  });
  return onChange;
}

describe('MovementPicker', () => {
  it('single mode is a radio group; a press reports exactly one movement', () => {
    const onChange = render({ selected: ['squats'], mode: 'single' });
    expect(byTestId('p')!.getAttribute('role')).toBe('radiogroup');
    expect(byTestId('p-squats')!.getAttribute('role')).toBe('radio');
    expect(byTestId('p-squats')!.getAttribute('aria-checked')).toBe('true');
    expect(byTestId('p-steps')!.getAttribute('aria-checked')).toBe('false');
    act(() => byTestId('p-steps')!.click());
    expect(onChange).toHaveBeenLastCalledWith(['steps']);
  });

  it('multiple mode is a checkbox group that toggles', () => {
    const onChange = render({ selected: ['squats'], mode: 'multiple' });
    expect(byTestId('p-squats')!.getAttribute('role')).toBe('checkbox');
    act(() => byTestId('p-push-ups')!.click());
    expect(onChange).toHaveBeenLastCalledWith(['squats', 'push-ups']);
  });

  it('offers Something else as its own checked choice, and reports the press', () => {
    const onPress = vi.fn();
    render({ selected: [], mode: 'single', somethingElse: { selected: true, onPress } });
    const other = byTestId('p-something-else')!;
    expect(other.getAttribute('role')).toBe('radio');
    expect(other.getAttribute('aria-checked')).toBe('true');
    expect(other.textContent).toContain('Something else');
    act(() => other.click());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides Something else when the screen does not offer it', () => {
    render({ selected: [] });
    expect(byTestId('p-something-else')).toBeNull();
  });

  it('toggles on Space, the way a checkbox or radio must', () => {
    const onChange = render({ selected: [], mode: 'single' });
    act(() => {
      byTestId('p-laps')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(['laps']);
  });

  it('says only the hint the screen passes', () => {
    render({ selected: [], hint: 'Pick a movement.' });
    expect(container.textContent).toContain('Pick a movement.');
    expect(container.textContent).not.toContain('several');
  });
});
