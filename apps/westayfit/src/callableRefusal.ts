/**
 * NATIVE-MEMBER-1 (HB-02, MF-04). DID THE FUNCTION ITSELF REFUSE, OR IS THE
 * REFUSAL NOT CONFIRMED?
 *
 * The refusals this product's function HANDLERS make are `HttpsError`s with
 * a sentence the handler wrote ("Members only.", "Sign in first.", "Goal not
 * found."), and the SDK passes that sentence through as `e.message`. Only
 * that is the function's own statement about this account or this thing.
 *
 * Two other kinds of failure arrive with the same codes (401/403/404 ->
 * `unauthenticated`, `permission-denied`, `not-found`) but no such sentence:
 *   · a refusal IN FRONT OF the function -- the staging hold's Cloud Run
 *     invoker check, a missing deployment, a proxy. The body is not the
 *     function's, so the SDK uses the code itself as the message
 *     (`@firebase/functions` `_errorForResponse`), or the body names only a
 *     status (`PERMISSION_DENIED`, `Forbidden`, `Not Found`);
 *   · a refusal by the FUNCTIONS FRAMEWORK before the handler runs -- an
 *     invalid or revoked ID token, or a failed App Check: firebase-functions'
 *     onCall throws `HttpsError('unauthenticated', 'Unauthenticated')`.
 * Neither is the handler speaking, and the client cannot tell them apart.
 * So neither is reported as "refused": not "this account is not allowed",
 * not "sign in again", not "no longer a member". They are NOT CONFIRMED, and
 * the screens say only that the thing did not go through (Members: the list
 * is temporarily unavailable, as HB-02 specifies; the marker: try again; the
 * privacy panel: not saved or unconfirmed). This module makes no claim about
 * WHICH of the two it was.
 */

/** Codes that, in the handler's own words, are a statement about this account or this thing. */
const REFUSAL_CODES = new Set(['permission-denied', 'unauthenticated', 'not-found']);

/**
 * Messages that name only a status, never a handler's sentence: the code
 * itself in any spelling, the framework's "Unauthenticated", and the HTTP
 * reason phrases a proxy or front end may send. Compared lower-cased, with
 * `-`/`_` read as spaces and one trailing full stop ignored. None of the
 * handlers' own sentences is one of these.
 */
const STATUS_ONLY = new Set(['unauthenticated', 'unauthorized', 'permission denied', 'forbidden', 'not found']);

function normalised(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '');
}

function bareCode(e: unknown): string | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('functions/')) return null;
  return code.slice('functions/'.length);
}

/** True when a failed callable carries a sentence its handler wrote, not just a status. */
export function serverWroteMessage(e: unknown): boolean {
  const code = bareCode(e);
  if (!code) return false;
  const raw = (e as { message?: unknown }).message;
  const message = typeof raw === 'string' ? normalised(raw) : '';
  if (message === '') return false;
  if (message === normalised(code)) return false;
  if (STATUS_ONLY.has(message)) return false;
  return true;
}

/**
 * For a failed callable:
 *   refused       a refusal code in the handler's own words (a confirmed fact);
 *   notConfirmed  a refusal code with no handler sentence: a block in front of
 *                 the function, or the framework rejecting the token or App
 *                 Check. No claim about the account;
 *   null          not a refusal-coded callable failure at all.
 */
export type CallableRefusal = 'refused' | 'notConfirmed';
export function classifyCallableRefusal(e: unknown): CallableRefusal | null {
  const code = bareCode(e);
  if (code === null || !REFUSAL_CODES.has(code)) return null;
  return serverWroteMessage(e) ? 'refused' : 'notConfirmed';
}

/** A refusal-coded callable failure that the handler did not confirm in its own words. */
export function isUnconfirmedRefusal(e: unknown): boolean {
  return classifyCallableRefusal(e) === 'notConfirmed';
}
