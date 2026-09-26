/**
 * The changed-journey driver registry, read by hosted-changed-journeys.mjs.
 *
 * A driver is keyed by a milestone manifest journey id and exercises that
 * journey against the hosted staging site:
 *
 *   async ({ page, baseUrl, journey }) => ({
 *     setupId,            // the fixture or account shape it used, or null
 *     actionsPerformed,   // what it actually did, in order
 *     assertions,         // [{ expected, ok }], one per manifest expectation it checked
 *   })
 *
 * A journey with no driver here is reported BLOCKED ("no registered driver"),
 * never passed. Drivers are reviewed code on the operational branch, like the
 * rest of this directory; the candidate cannot supply one.
 *
 * Empty on purpose: the first drivers arrive with the first milestone manifest,
 * reviewed against that milestone's journeys.
 */
export const drivers = Object.freeze({});
