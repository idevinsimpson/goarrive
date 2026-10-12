/**
 * ANON-GATE-1 (#365 6077731662): a WSF callable answers people, not
 * placeholders.
 *
 * The shared `goarrive` project keeps Anonymous sign-in ENABLED, because
 * GoArrive's share page signs guests in anonymously
 * (apps/goarrive/app/share/[shareId].tsx). Any browser can therefore mint an
 * ID token whose `firebase.sign_in_provider` is `anonymous`, and every WSF
 * callable is public at the Cloud Run layer (#599 section 3). Without this
 * gate, a signed-in WSF callable that checks only `request.auth` would let
 * such a token create a profile, store a photo or read an account-scoped
 * answer under a throwaway uid.
 *
 * The provider stays on, and GoArrive is untouched. The refusal lives here
 * instead, at every WSF callable auth site:
 *   - `requireRealIdentity` follows each signed-in check and refuses an
 *     anonymous-provider token with `failed-precondition`. A caller with no
 *     token keeps the answer that site already gave.
 *   - `optionalRealUid` replaces `request.auth?.uid ?? null` where signing in
 *     is optional, so an anonymous caller is treated exactly as signed out.
 *
 * Pure: no Firestore, no network. A token with no `firebase` claim (the
 * shape every existing test fixture uses), or any provider other than
 * `anonymous`, passes unchanged.
 */
import { HttpsError } from 'firebase-functions/v2/https';

/** The one message an anonymous-provider token receives from a signed-in WSF callable. */
export const ANONYMOUS_REFUSAL = 'Sign in with an email account.';

type AuthLike = { uid: string; token?: { firebase?: { sign_in_provider?: unknown } } } | undefined;
type RequestLike = { auth?: AuthLike };

/** True only for a token Firebase minted through the Anonymous provider. */
export function isAnonymousIdentity(auth: AuthLike): boolean {
  return auth?.token?.firebase?.sign_in_provider === 'anonymous';
}

/**
 * Throws unless the caller is signed in with a real (non-anonymous) account.
 * Every call site keeps its own signed-out check in front of this one, so the
 * `unauthenticated` branch here only backs that check up.
 */
export function requireRealIdentity(request: RequestLike): void {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (isAnonymousIdentity(request.auth)) throw new HttpsError('failed-precondition', ANONYMOUS_REFUSAL);
}

/** The caller's uid where signing in is optional; null for a signed-out or anonymous caller. */
export function optionalRealUid(request: RequestLike): string | null {
  const auth = request.auth;
  if (!auth || isAnonymousIdentity(auth)) return null;
  return auth.uid;
}
