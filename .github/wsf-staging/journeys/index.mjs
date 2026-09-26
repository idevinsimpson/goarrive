/**
 * The changed-journey driver registry, read by hosted-changed-journeys.mjs and
 * by check-milestone-manifest.mjs (every journey a manifest names must have a
 * driver here before a deploy is allowed to start).
 *
 * A driver is keyed by a milestone manifest journey id and exercises that
 * journey against the hosted staging site:
 *
 *   async ({ page, baseUrl, journey, fixtures }) => ({
 *     setupId,            // the fixture shape it used (never an email or password)
 *     actionsPerformed,   // what it actually did, in order
 *     assertions,         // [{ expected, ok }], each from what the page rendered
 *   })
 *
 * `fixtures` is journeys/fixture-kit.mjs, bound to this run's tag and its own
 * cleanup manifest. Drivers are reviewed code on the operational branch, like
 * the rest of this directory: adding or changing one is a release-environment
 * change and takes the human path. The candidate cannot supply one.
 */
import { community } from './community.mjs';
import { settings } from './settings.mjs';

export const drivers = Object.freeze({ community, settings });
