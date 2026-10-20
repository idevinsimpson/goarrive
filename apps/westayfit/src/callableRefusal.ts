/**
 * NATIVE-MEMBER-1 (HB-02, MF-04). WHO REFUSED: THE FUNCTION, OR SOMETHING IN
 * FRONT OF IT?
 *
 * Every refusal this product's functions make is an `HttpsError` with a
 * sentence the function wrote ("Members only.", "Sign in first.", the
 * not-found message), and the SDK passes that sentence through as
 * `e.message`. A refusal made BEFORE the function runs -- the staging hold's
 * Cloud Run invoker check, a missing deployment, a proxy -- has no such body:
 * the SDK maps the bare HTTP status (401, 403, 404) to a code and uses the
 * code itself as the message (`@firebase/functions` `_errorForResponse`). A
 * body that names only the status (`PERMISSION_DENIED`) or an empty message
 * says no more than that.
 *
 * So "this account is not allowed", "sign in again" and "you are no longer a
 * member" are only true when the function itself said so. Everything else is
 * a server that could not be reached in the usual way, and the screens say
 * that instead of a claim about the account.
 */

/** Codes that, from the function itself, are a statement about this account or this thing. */
const REFUSAL_CODES = new Set(['permission-denied', 'unauthenticated', 'not-found']);

function bareCode(e: unknown): string | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('functions/')) return null;
  return code.slice('functions/'.length);
}

/** True when a failed callable carries a sentence its function wrote, not just its status. */
export function serverWroteMessage(e: unknown): boolean {
  const code = bareCode(e);
  if (!code) return false;
  const raw = (e as { message?: unknown }).message;
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (message === '') return false;
  if (message.toLowerCase() === code) return false;
  if (message.toUpperCase() === code.toUpperCase().replace(/-/g, '_')) return false;
  return true;
}

/**
 * A refusal-coded callable failure (`permission-denied`, `unauthenticated`,
 * `not-found`) with no sentence from the function: a block in front of it,
 * never a fact about the account.
 */
export function isBodylessRefusal(e: unknown): boolean {
  const code = bareCode(e);
  return code !== null && REFUSAL_CODES.has(code) && !serverWroteMessage(e);
}
