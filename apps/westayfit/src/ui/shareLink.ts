/**
 * NATIVE-MEMBER-1 F-3 (MF-01). ONE WAY TO COPY OR SHARE A LINK — THE WEB'S.
 *
 * Community detail and the Champion's Manage sheet pass a link on in six
 * places: Copy invite, Share invite, the public display share, and the
 * kiosk, station and combined "Copy link". Every one of them now goes through
 * this module. This file is what the web (and the test runner) gets, and it
 * is exactly what those six call sites did inline before: `navigator.share`
 * when the browser has it, otherwise `navigator.clipboard.writeText`, a
 * rejected copy reported as a failure and a dismissed sheet reported as
 * nothing. The app gets `shareLink.native.ts`: expo-clipboard and React
 * Native's Share API, offered only for an absolute https link.
 */
import { shareRoute, type ShareRoute } from '../shareGoalDisplay';

export type CopyOutcome = 'copied' | 'failed';

/** Whether Copy or Share may be offered for this link here. The web offers any link it built. */
export function offerableLink(url: string | null | undefined): url is string {
  return typeof url === 'string' && url !== '';
}

/**
 * Whether the Copy controls are drawn. On the web, always, exactly as before;
 * in the app, only with expo-clipboard's native module (shareLink.native.ts).
 */
export function offersCopy(): boolean {
  return true;
}

/** Whether a copy can be attempted at all (no navigator: a server render). */
export function canAttemptCopy(): boolean {
  return typeof navigator !== 'undefined';
}

/** Whether there is a share sheet to open: the Web Share API. */
export function hasShareSheet(): boolean {
  return typeof navigator !== 'undefined' && 'share' in navigator;
}

/** The public display control's route (src/shareGoalDisplay.ts). */
export function linkShareRoute(): ShareRoute {
  return shareRoute(typeof navigator === 'undefined' ? null : navigator);
}

/** Puts `url` on the clipboard; 'failed' only when the clipboard call did not succeed. */
export async function copyLink(url: string): Promise<CopyOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * Opens the share sheet with `url` (and `title` when given). A rejection is a
 * dismissal as often as a failure and the two cannot be told apart, so
 * neither is reported.
 */
export async function shareLinkSheet(content: { url: string; title?: string }): Promise<void> {
  if (!hasShareSheet()) return;
  try {
    await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share(
      content.title !== undefined ? { title: content.title, url: content.url } : { url: content.url },
    );
  } catch {
    // Dismissed, or blocked by the browser: no claim either way.
  }
}
