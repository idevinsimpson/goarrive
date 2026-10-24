/** Resolve only signed member claims, scoped to the session's coach. */
export function ownsSessionMember(uid: string, claims: Record<string, any>, session: { memberId?: string; coachId?: string }): boolean {
  return !!session.memberId && (uid === session.memberId || (
    claims.role === 'member' && claims.coachId === session.coachId &&
    typeof claims.memberId === 'string' && claims.memberId === session.memberId
  ));
}
