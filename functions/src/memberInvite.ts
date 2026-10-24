import { randomBytes } from 'crypto';
import type { Auth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';

/** Retryable preparation: existing Auth accounts are reused; email is never sent. */
export async function prepareMemberInvite(auth: Auth, memberId: string, member: Record<string, any>, appUrl: string, linkMember: (uid: string, email: string) => Promise<void>) {
  const email = String(member.email ?? '').trim().toLowerCase();
  if (!email) throw new HttpsError('failed-precondition', 'Add an email before sending an invite');
  let user;
  let authCreated = false;
  try { user = await auth.getUserByEmail(email); }
  catch (error: any) {
    if (error.code !== 'auth/user-not-found') throw error;
    try {
      user = await auth.createUser({ email, password: randomBytes(24).toString('base64'), displayName: member.displayName || member.name || '' });
      authCreated = true;
    } catch (createError: any) {
      if (createError.code !== 'auth/email-already-exists') throw createError;
      user = await auth.getUserByEmail(email);
    }
  }
  const claims = user.customClaims || {};
  if ((member.uid && member.uid !== user.uid) ||
      (claims.role && claims.role !== 'member') || claims.admin === true ||
      (claims.memberId && claims.memberId !== memberId) ||
      (claims.coachId && claims.coachId !== member.coachId)) {
    throw new HttpsError('failed-precondition', 'This account is linked to another role or membership');
  }
  // Verify link generation before changing claims or marking the roster linked.
  // If any later step fails, retry reuses the same account and safely repeats it.
  const resetLink = await auth.generatePasswordResetLink(email, { url: appUrl, handleCodeInApp: false });
  await auth.setCustomUserClaims(user.uid, { ...claims, role: 'member', coachId: member.coachId, tenantId: member.tenantId ?? member.coachId, memberId });
  await linkMember(user.uid, email);
  return { success: true, resetLink, email, authCreated };
}
