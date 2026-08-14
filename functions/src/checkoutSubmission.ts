export interface CheckoutSubmissionProjection {
  coachId: string;
  programName: string | null;
  folderId: string | null;
  subscriptionPathId: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Allowlist the non-PII fields needed to render anonymous funnel checkout.
 */
export function projectCheckoutSubmission(
  data: Record<string, unknown>,
): CheckoutSubmissionProjection {
  return {
    coachId: stringOrNull(data.coachId) ?? '',
    programName: stringOrNull(data.programName),
    folderId: stringOrNull(data.folderId),
    subscriptionPathId: stringOrNull(data.subscriptionPathId),
  };
}
