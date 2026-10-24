/** Member copies cannot become sync sources, even after their assignment is removed. */
export function isTemplateCandidate(data: Record<string, any>): boolean {
  return !data.isArchived && !data.assignedMemberId && !data.templateSourceId && !data.sourcePlaybookId;
}

/** Firestore rejects undefined values nested inside subscription-path arrays. */
export function subscriptionPathOptions(musicStyle: string, pricePerMonthCents: number | undefined) {
  return {
    ...(musicStyle ? { musicStyle } : {}),
    ...(pricePerMonthCents !== undefined ? { pricePerMonthCents } : {}),
  };
}
