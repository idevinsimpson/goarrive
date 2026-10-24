/** Retain pre-link Auth-UID bookings alongside current roster-keyed bookings. */
export function sessionMemberIds(effectiveUid: string, rosterId: string): string[] {
  return [...new Set([effectiveUid, rosterId].filter(Boolean))];
}
