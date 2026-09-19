import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEVICE_CHOICE_HEADING,
  DEVICE_CHOICE_NOTE,
  DEVICE_CHOICE_PERSONAL_DESCRIPTION,
  DEVICE_CHOICE_PERSONAL_LABEL,
  DEVICE_CHOICE_SHARED_DESCRIPTION,
  DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP,
  DEVICE_CHOICE_SHARED_LABEL,
  DEVICE_SHARED_CONTINUE,
  DEVICE_SHARED_RESET,
  DEVICE_SHARED_TITLE,
} from '../src/deviceMode';
import { DeviceChoice, SharedScreenNotice } from '../src/ui/DeviceChoice';

/**
 * The device question rendered into jsdom through react-native-web: the
 * elements the browser spec selects by testID, and the fact that each answer
 * actually fires. Which answer a screen then acts on belongs to
 * tests/device-mode.test.ts (the decision) and to
 * tests-e2e/ui-device-choice.spec.ts (the whole walk-up).
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

function click(id: string): void {
  act(() => {
    byTestId(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function renderChoice(
  extra: Partial<Parameters<typeof DeviceChoice>[0]> = {}
): { personal: ReturnType<typeof vi.fn>; shared: ReturnType<typeof vi.fn> } {
  const personal = vi.fn();
  const shared = vi.fn();
  act(() => {
    root.render(
      <DeviceChoice
        onChoosePersonal={personal}
        onChooseShared={shared}
        testID="wsf-device-choice"
        {...extra}
      />
    );
  });
  return { personal, shared };
}

describe('DeviceChoice', () => {
  it('asks the question and offers exactly two answers', () => {
    renderChoice();
    expect(byTestId('wsf-device-choice')?.textContent).toContain(DEVICE_CHOICE_HEADING);
    expect(byTestId('wsf-device-choice-personal-label')?.textContent).toBe(
      DEVICE_CHOICE_PERSONAL_LABEL
    );
    expect(byTestId('wsf-device-choice-personal-description')?.textContent).toBe(
      DEVICE_CHOICE_PERSONAL_DESCRIPTION
    );
    expect(byTestId('wsf-device-choice-shared-label')?.textContent).toBe(DEVICE_CHOICE_SHARED_LABEL);
    expect(byTestId('wsf-device-choice-shared-description')?.textContent).toBe(
      DEVICE_CHOICE_SHARED_DESCRIPTION
    );
    expect(byTestId('wsf-device-choice-note')?.textContent).toBe(DEVICE_CHOICE_NOTE);
    // No third answer, and nothing else that could be tapped.
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(2);
  });

  it('presents each answer as a button, because each one acts immediately', () => {
    renderChoice();
    for (const id of ['wsf-device-choice-personal', 'wsf-device-choice-shared']) {
      expect(byTestId(id)?.getAttribute('role')).toBe('button');
      // Nothing here is a radio: there is no selection to submit afterwards.
      expect(byTestId(id)?.hasAttribute('aria-checked')).toBe(false);
    }
    expect(byTestId('wsf-device-choice-personal')?.getAttribute('aria-label')).toContain(
      DEVICE_CHOICE_PERSONAL_LABEL
    );
    expect(byTestId('wsf-device-choice-shared')?.getAttribute('aria-label')).toContain(
      DEVICE_CHOICE_SHARED_DESCRIPTION
    );
  });

  it('fires the answer that was tapped, and only that one', () => {
    const a = renderChoice();
    click('wsf-device-choice-personal');
    expect(a.personal).toHaveBeenCalledTimes(1);
    expect(a.shared).not.toHaveBeenCalled();

    const b = renderChoice();
    click('wsf-device-choice-shared');
    expect(b.shared).toHaveBeenCalledTimes(1);
    expect(b.personal).not.toHaveBeenCalled();
  });

  // On the page whose next step would be creating an account, the shared
  // option says what will NOT happen instead of describing a contribution the
  // visitor cannot make yet.
  it('swaps the shared answer’s consequence on the signup path', () => {
    renderChoice({ signupAhead: true });
    expect(byTestId('wsf-device-choice-shared-description')?.textContent).toBe(
      DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP
    );
    expect(byTestId('wsf-device-choice')?.textContent).not.toContain(DEVICE_CHOICE_SHARED_DESCRIPTION);
    // The other answer is unchanged by it.
    expect(byTestId('wsf-device-choice-personal-description')?.textContent).toBe(
      DEVICE_CHOICE_PERSONAL_DESCRIPTION
    );
  });

  it('never shows a join code, a goal id or a device secret', () => {
    renderChoice();
    const html = container.innerHTML;
    expect(html).not.toMatch(/join code|invite code/i);
    expect(html).not.toMatch(/goalId|stationId|secret/i);
  });

  it('takes its testIDs from the one it is given, so a screen can name its own', () => {
    const personal = vi.fn();
    const shared = vi.fn();
    act(() => {
      root.render(
        <DeviceChoice onChoosePersonal={personal} onChooseShared={shared} testID="wsf-other" />
      );
    });
    expect(byTestId('wsf-other-personal')).not.toBeNull();
    expect(byTestId('wsf-other-shared')).not.toBeNull();
    expect(byTestId('wsf-device-choice-personal')).toBeNull();
  });
});

describe('SharedScreenNotice', () => {
  function renderNotice(): {
    onContinue: ReturnType<typeof vi.fn>;
    onUseOwnPhone: ReturnType<typeof vi.fn>;
  } {
    const onContinue = vi.fn();
    const onUseOwnPhone = vi.fn();
    act(() => {
      root.render(
        <SharedScreenNotice
          onContinue={onContinue}
          onUseOwnPhone={onUseOwnPhone}
          testID="wsf-device-shared"
        />
      );
    });
    return { onContinue, onUseOwnPhone };
  }

  it('states the standing answer and offers the shared session', () => {
    renderNotice();
    const text = byTestId('wsf-device-shared')?.textContent ?? '';
    expect(text).toContain(DEVICE_SHARED_TITLE);
    expect(text).toContain(DEVICE_SHARED_CONTINUE);
    expect(byTestId('wsf-device-shared-continue')?.getAttribute('role')).toBe('button');
  });

  it('offers the way back for a phone that answered by mistake', () => {
    // Without this control, re-scanning the same QR would send a personal
    // phone to the shared screen's page for ever.
    renderNotice();
    expect(byTestId('wsf-device-shared-reset')?.textContent).toBe(DEVICE_SHARED_RESET);
    expect(byTestId('wsf-device-shared-reset')?.getAttribute('role')).toBe('button');
  });

  it('fires the control that was tapped, and only that one', () => {
    const a = renderNotice();
    click('wsf-device-shared-continue');
    expect(a.onContinue).toHaveBeenCalledTimes(1);
    expect(a.onUseOwnPhone).not.toHaveBeenCalled();

    const b = renderNotice();
    click('wsf-device-shared-reset');
    expect(b.onUseOwnPhone).toHaveBeenCalledTimes(1);
    expect(b.onContinue).not.toHaveBeenCalled();
  });

  it('offers no personal sign-in at all', () => {
    renderNotice();
    const text = byTestId('wsf-device-shared')?.textContent ?? '';
    expect(text).not.toMatch(/sign in|create an account|sign up/i);
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(2);
  });
});
