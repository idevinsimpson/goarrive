/**
 * NATIVE-MEMBER-1 F-3 (MF-01). ONE WAY TO COPY OR SHARE A LINK — THE APP'S.
 *
 * React Native has no `navigator.share` and no `navigator.clipboard` (its
 * navigator is `{ product: 'ReactNative' }`), so the six controls that pass a
 * link on were never callable on a phone. Here:
 *   · Copy is expo-clipboard's `setStringAsync`. "Copied" is shown only when
 *     it resolves true; "Copy didn't work" only when it rejects or says false.
 *   · Share is React Native's Share API: iOS gets `{ url }` (and the title as
 *     the message when there is one), Android gets `{ message: url }`.
 *     Dismissing the sheet changes nothing on screen.
 *   · Both are offered, and act, only for an absolute https link
 *     (`isShareableHttpsUrl`): never a development build's Metro address or
 *     tunnel, never a half-built or relative one.
 *
 * EXPO-CLIPBOARD IS OPTIONAL (review F3-N1). Importing it calls
 * `requireNativeModule('ExpoClipboard')`, which THROWS in a binary or
 * development client built before the dependency was added -- and with
 * routes loaded eagerly in development, one throwing import stops the whole
 * app from starting. So it is never imported up front: `offersCopy()` asks
 * whether the native module is present (`requireOptionalNativeModule`, which
 * does not throw), and `copyLink` imports expo-clipboard only then. Without
 * the module, Copy is simply not offered; Share does not need it.
 *
 * Same exports as `shareLink.ts`, which the web and the test runner get.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform, Share } from 'react-native';

import { isShareableHttpsUrl, shareRoute, type ShareRoute } from '../shareGoalDisplay';

export type CopyOutcome = 'copied' | 'failed';

/** Whether Copy or Share may be offered for this link: absolute https only. */
export function offerableLink(url: string | null | undefined): url is string {
  return isShareableHttpsUrl(url);
}

/** Whether this binary has expo-clipboard's native module. Never throws. */
export function offersCopy(): boolean {
  try {
    return requireOptionalNativeModule('ExpoClipboard') != null;
  } catch {
    return false;
  }
}

/** A copy can be attempted only with the clipboard module present. */
export function canAttemptCopy(): boolean {
  return offersCopy();
}

/** The OS share sheet is always there; whether it may be offered is `offerableLink`. */
export function hasShareSheet(): boolean {
  return true;
}

/** The public display control's route: `nativeShare` once there is an https origin. */
export function linkShareRoute(): ShareRoute {
  return shareRoute(typeof navigator === 'undefined' ? null : navigator);
}

export async function copyLink(url: string): Promise<CopyOutcome> {
  if (!isShareableHttpsUrl(url) || !offersCopy()) return 'failed';
  try {
    const Clipboard = await import('expo-clipboard');
    return (await Clipboard.setStringAsync(url)) === false ? 'failed' : 'copied';
  } catch {
    return 'failed';
  }
}

export async function shareLinkSheet(content: { url: string; title?: string }): Promise<void> {
  const { url, title } = content;
  if (!isShareableHttpsUrl(url)) return;
  try {
    // A dismissal resolves with `dismissedAction` (iOS); nothing to say.
    await Share.share(
      Platform.OS === 'ios' ? (title !== undefined ? { url, message: title } : { url }) : { message: url },
    );
  } catch {
    // The sheet could not open: no claim either way, as on the web.
  }
}
