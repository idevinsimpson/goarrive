/**
 * Small, honest page helpers shared by the drivers. Each read reports what it
 * actually saw, so a failed assertion names the value, not just "not found".
 */
export const vis = (page, testId) => page.locator(`[data-testid="${testId}"]:visible`).first();

/**
 * Poll a visible element's text until `accept(text)` or the timeout; returns the
 * last text seen (null if never visible). Counted in 500 ms page waits rather
 * than wall-clock reads, so the timeout is the page's own clock.
 */
export async function textWhen(page, testId, accept, timeout = 45_000) {
  let last = null;
  for (let tries = Math.ceil(timeout / 500); tries > 0; tries -= 1) {
    try {
      const el = vis(page, testId);
      if (await el.count()) {
        last = ((await el.innerText({ timeout: 2_000 })) || '').replace(/\s+/g, ' ').trim();
        if (accept(last)) return last;
      }
    } catch { /* re-rendering; poll again */ }
    await page.waitForTimeout(500);
  }
  return last;
}

/** A fact row's value: the text after its label ("Members 2" -> "2"). */
export const factValue = (text, label) => (text === null ? null : text.replace(label, '').trim());

export async function attr(page, testId, name) {
  const el = vis(page, testId);
  return (await el.count()) ? el.getAttribute(name) : null;
}

/** The driver's record: every assertion carries what was expected and what was seen. */
export function recorder() {
  const actionsPerformed = [];
  const assertions = [];
  return {
    actionsPerformed,
    assertions,
    did: (a) => actionsPerformed.push(a),
    expect: (expected, ok, seen) => assertions.push({ expected: seen === undefined ? expected : `${expected} (saw: ${String(seen).slice(0, 120)})`, ok: ok === true }),
  };
}
