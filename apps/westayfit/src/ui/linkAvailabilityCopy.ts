/**
 * NATIVE-MEMBER-1 F-4 (MF-06). WHAT A MISSING LINK SAYS, PER PLATFORM.
 *
 * Community detail and the Champion's Manage sheet build their invite, kiosk,
 * station and combined addresses from the origin the build is served from.
 * On the web that origin always exists, so a missing link means a render
 * without `window`, and "Reload the page" is the way out — that copy is kept
 * byte for byte. The app has no page to reload and, until a public origin is
 * configured for native builds (INT-08), no link at all, so it says what is
 * true there: the link is not available in the app yet, and where it is.
 *
 * Pure: the caller passes `Platform.OS`, so both platforms are tested here.
 */
export type LinkAvailabilityCopy = {
  /** "Open kiosk" is offered on this platform (MF-08 interim: web only). */
  offersOpenKiosk: boolean;
  kioskUnavailable: string;
  stationUnavailable: string;
  combinedUnavailable: string;
  inviteUnavailable: string;
  qrUnavailable: string;
  kioskGoalsFailed: string;
  /** Precedes the address when Copy kiosk link fails. */
  kioskCopyFailed: string;
};

const WEB: LinkAvailabilityCopy = {
  offersOpenKiosk: true,
  kioskUnavailable: 'The kiosk link isn’t ready yet. Reload the page to try again.',
  stationUnavailable: 'The station link isn’t ready yet. Reload the page to try again.',
  combinedUnavailable: 'The combined link isn’t ready yet. Reload the page to try again.',
  inviteUnavailable: "Your invite link isn't ready yet. Reload the page to try again.",
  qrUnavailable:
    "This community's invite link is not ready yet, so there is nothing to encode. Close this and open it again.",
  kioskGoalsFailed:
    "This community's goals could not be loaded, so there is no kiosk address to give you. Close this and open it again.",
  kioskCopyFailed: 'Copy didn’t work on this device. Open the kiosk here, or type this address on the screen: ',
};

/*
  The kiosk is a signed-out venue screen: opened inside a Champion's own app
  it would end their session (MF-08), so the app does not offer it until the
  kiosk return lands (ST-05). The station and combined screens sign nobody
  out and stay one tap away.
*/
const APP: LinkAvailabilityCopy = {
  offersOpenKiosk: false,
  kioskUnavailable: 'The kiosk link isn’t available in the app yet. Open this community on the web to copy it.',
  stationUnavailable: 'The station link isn’t available in the app yet. Open this community on the web to copy it.',
  combinedUnavailable: 'The combined screen’s web address isn’t available in the app yet. Open the combined screen here.',
  inviteUnavailable: 'Your invite link isn’t available in the app yet. Open this community on the web to share it.',
  qrUnavailable: 'This community’s invite link isn’t available in the app yet, so there is nothing to encode.',
  kioskGoalsFailed: 'This community’s goals could not be loaded, so there is no kiosk address to give you.',
  kioskCopyFailed: 'Copy didn’t work on this device. Type this address on the screen: ',
};

export function linkAvailabilityCopy(os: string): LinkAvailabilityCopy {
  return os === 'web' ? WEB : APP;
}
