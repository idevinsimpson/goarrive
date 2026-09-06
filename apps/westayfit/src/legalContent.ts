/**
 * Legal copy — inline mirror of `apps/westayfit/legal/{terms,privacy}.md`.
 *
 * Why not import the .md files at runtime: Metro's default web config does not
 * resolve .md; wiring a transformer just to ship a 3-line placeholder would be
 * more code than the placeholder itself. The .md files remain the human-facing
 * copies (legal review, PR diffs, editor tooling). When real approved text
 * arrives, both files (this and the .md) get updated in the same PR — the sync
 * is enforced by an e2e assertion that the accordion body contains the version
 * line.
 */

export const WSF_TERMS_MARKDOWN = `# We Stay Fit — Terms of Service

Version pending-approval-2026-08-25

This text is pending approval and will be replaced before public launch.
`;

export const WSF_PRIVACY_MARKDOWN = `# We Stay Fit — Privacy Policy

Version pending-approval-2026-08-25

This text is pending approval and will be replaced before public launch.
`;
