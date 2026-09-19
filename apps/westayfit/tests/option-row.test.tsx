import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OptionGroup, OptionRow } from '../src/ui/OptionRow';

/**
 * The option row rendered into jsdom through react-native-web: the piece of a
 * guided decision that the browser specs select by testID and read by
 * aria-checked. Screen-level behaviour (which rows a screen offers, what
 * picking one submits) belongs to those specs.
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

function renderRow(selected: boolean, extra: Partial<Parameters<typeof OptionRow>[0]> = {}): void {
  act(() => {
    root.render(
      <OptionGroup accessibilityLabel="Who can join" testID="wsf-test-group">
        <OptionRow
          label="Anyone with the link"
          description="People who open the invite can join without approval."
          selected={selected}
          onPress={() => {}}
          testID="wsf-test-option"
          {...extra}
        />
      </OptionGroup>,
    );
  });
}

describe('OptionRow', () => {
  it('renders the label and the description inside a radio row', () => {
    renderRow(false);
    const row = byTestId('wsf-test-option');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('role')).toBe('radio');
    expect(byTestId('wsf-test-option-label')?.textContent).toBe('Anyone with the link');
    expect(byTestId('wsf-test-option-description')?.textContent).toBe(
      'People who open the invite can join without approval.',
    );
    expect(row?.getAttribute('aria-label')).toContain('Anyone with the link');
  });

  it('always shows the indicator ring, and fills the dot only when selected', () => {
    renderRow(false);
    expect(byTestId('wsf-test-option-indicator')).not.toBeNull();
    expect(byTestId('wsf-test-option-indicator-dot')).toBeNull();

    renderRow(true);
    expect(byTestId('wsf-test-option-indicator')).not.toBeNull();
    expect(byTestId('wsf-test-option-indicator-dot')).not.toBeNull();
  });

  it('toggles aria-checked with the selected prop, and never emits aria-selected', () => {
    // aria-checked is the state attribute ARIA allows on role="radio";
    // aria-selected is not (axe: aria-allowed-attr), so the row must not
    // publish it — not through accessibilityState.selected either.
    renderRow(false);
    expect(byTestId('wsf-test-option')?.getAttribute('aria-checked')).toBe('false');
    expect(byTestId('wsf-test-option')?.hasAttribute('aria-selected')).toBe(false);

    renderRow(true);
    expect(byTestId('wsf-test-option')?.getAttribute('aria-checked')).toBe('true');
    expect(byTestId('wsf-test-option')?.hasAttribute('aria-selected')).toBe(false);

    renderRow(false);
    expect(byTestId('wsf-test-option')?.getAttribute('aria-checked')).toBe('false');
    expect(byTestId('wsf-test-option')?.hasAttribute('aria-selected')).toBe(false);
  });

  it('keeps the label, description and indicator in place whether selected or not', () => {
    // The row's skeleton (every element with a testID, in document order)
    // must be the same in both states except for the inner dot: nothing is
    // added, removed or re-ordered, so the row keeps its geometry when picked.
    const skeleton = () =>
      Array.from(container.querySelectorAll('[data-testid]'))
        .map((el) => el.getAttribute('data-testid'))
        .filter((id) => id !== 'wsf-test-option-indicator-dot');
    renderRow(false);
    const unselected = skeleton();
    renderRow(true);
    expect(skeleton()).toEqual(unselected);
    expect(unselected).toEqual([
      'wsf-test-group',
      'wsf-test-option',
      'wsf-test-option-indicator',
      'wsf-test-option-label',
      'wsf-test-option-description',
    ]);
  });

  it('calls onPress when tapped and not when disabled', () => {
    const onPress = vi.fn();
    renderRow(false, { onPress });
    act(() => {
      byTestId('wsf-test-option')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPress).toHaveBeenCalledTimes(1);

    renderRow(false, { onPress, disabled: true });
    act(() => {
      byTestId('wsf-test-option')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(byTestId('wsf-test-option')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders the badge next to the label when given', () => {
    renderRow(false, { badge: 'Recommended' });
    expect(byTestId('wsf-test-option')?.textContent).toContain('Recommended');
  });

  it('wraps the rows in a labelled radio group', () => {
    renderRow(false);
    const group = byTestId('wsf-test-group');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.getAttribute('aria-label')).toBe('Who can join');
  });
});
