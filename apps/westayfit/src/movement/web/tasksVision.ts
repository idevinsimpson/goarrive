/**
 * WHY THIS FILE EXISTS: TWO BUNDLER CONSTRAINTS.
 *
 * 1. The package's ESM build (vision_bundle.mjs) contains
 *    `import(t.toString())`, a dynamic import Metro refuses to bundle
 *    ("Invalid call ... import(t.toString())"), and Metro picks that build for
 *    the package root. The CommonJS build loads its WASM loader with a
 *    <script> tag instead, and bundles cleanly. That subpath is not in the
 *    package's `exports`, so Metro falls back to file resolution for it (and
 *    says so with a warning at build time); types still come from the root.
 * 2. mediapipe.ts reaches this module only through `await import()`, so the
 *    ~137 KB engine is split into its own chunk and loaded only when someone
 *    presses "Start camera" in the lab, never on a member page.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tasksVision: typeof import('@mediapipe/tasks-vision') = require('@mediapipe/tasks-vision/vision_bundle.cjs');

export default tasksVision;
