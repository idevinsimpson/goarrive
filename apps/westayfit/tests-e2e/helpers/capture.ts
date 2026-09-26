/**
 * Accepted evidence is written ONLY when somebody asks for it.
 *
 * A committed BEFORE / TARGET / AFTER frame is the thing a review decided on.
 * When the spec that produces it runs in the ordinary suite, every
 * verification pass rewrites it — which is how a Page 2 "BEFORE" once became
 * byte-identical to its own AFTER without anyone noticing, and how seven
 * accepted Page 2 AFTERs and a Page 1 target matrix turned up dirty in a
 * routine run months later.
 *
 * Two shapes, because the specs are two kinds of thing:
 *
 *   A spec that ONLY produces images is skipped outright when nobody opted
 *   in. There is nothing to lose: it asserts nothing.
 *
 *   A spec that also ASSERTS — that a control clears the shell, that a tab
 *   reports itself current — keeps running every time and writes its frames
 *   through `saveFrame`. The checks stay; only the bytes are withheld.
 *   Gating the whole file would have been quietly deleting coverage.
 */
export const CAPTURE_FRAMES = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');

/** Anything Playwright lets you screenshot: a Page, a Locator, an element. */
type Shooter = { screenshot: (options: Record<string, unknown>) => Promise<unknown> };

/**
 * Write a frame, but only when frame capture was explicitly asked for.
 *
 * Returns whether it wrote, so a caller can say so; callers that ignore it
 * behave exactly as before minus the write.
 */
export async function saveFrame(
  shooter: Shooter,
  filePath: string,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  if (!CAPTURE_FRAMES) return false;
  await shooter.screenshot({ ...options, path: filePath });
  return true;
}
