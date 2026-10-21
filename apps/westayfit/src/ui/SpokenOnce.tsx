import { useAnnounce } from './announce';

/**
 * W13-4 (INT-18). Says `message` to a screen reader once per `announceKey`
 * while it is mounted, on a phone, through the shared helper
 * (src/ui/announce.native.ts: once per key, only in the foreground, queued,
 * cancelled on unmount). Renders nothing. On the web it says nothing either:
 * the live region it sits in (`liveRegion`, `aria-live="polite"`) speaks, as
 * it always has.
 *
 * A component rather than a hook call in the screen, because the state
 * screens it serves are early returns of one large route: a hook there would
 * have to run on every render path, while this one exists exactly as long as
 * the sheet it announces.
 */
export function SpokenOnce({ message, announceKey }: { message: string; announceKey: string }): null {
  useAnnounce(message, announceKey);
  return null;
}
