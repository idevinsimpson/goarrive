# Video benchmark — independent review and execution checkpoint

Date: 2026-10-04 UTC (2026-10-03 Eastern).
Standing: isolated R&D evidence only. No integration, merge, deployment, training, production contribution credit or public footage distribution.

## Exact references and ownership

- Lovable research project: `c1b16a13-34ff-4878-b798-750cc63aa595`.
- Improved r6 source: `44085e209855f360efb27ecea173404060873d6f` (owner reported it was better; not quantitative accuracy acceptance).
- Reviewed first benchmark seam: `e9d5f452da7d58d7f014106af25e71e76b38c538`.
- Evaluator: `src/lab/rep-counter-proof/bench/evaluator.ts`.
- GitHub research parent before this documentation: `c1266ff65112fb46ea39131055acad443f4376e3` in draft PR #574. Its r2 instructions remain historical, not the current phone candidate.
- One implementation owner: Lovable for benchmark code/scripts/tests. Director independently reviews scoring/source rights and records evidence. Existing product/staging worker assignments are unchanged.
- Actual implementation message: `umsg_01m423hg9gfr9aaxdacyvrg8em`, thread `main`, sent 2026-10-04T00:03:11Z. Read-back confirmed RUNNING. This is a dispatched code-and-real-replay task, not another design-only request.

## Independent checks performed

Executed the inspected `matchCycles`, `validateManifest` and `calibrationOnly` source-function excerpts with Node 22.16.0 after stripping type annotations with TypeScript 5.8.3. Six counterexamples reproduced. These are source-function tests with constructed inputs, not mounted-page, real-video or phone tests. A successful audit exit means a defect was reproduced, NOT acceptance of the old scorer.

| Finding | Observed old behavior |
| --- | --- |
| Duplicate near a cycle boundary masks a missed next completion | Two matches; zero misses/extras |
| Empty dataset | No validation error |
| Unsupported split plus unknown-rights string | No validation error |
| Unsorted and overlapping cycle intervals | No validation error |
| Same source family in calibration and holdout | No validation error; filter does not enforce isolation |
| Missing manifest revision | No validation error |

### Minimal exact-scoring reproduction

The implementation at e9d5 accepts a count anywhere from a cycle's start through its end plus 300 ms. With cycles `[0,1000]`, `[1000,2000]`, counts at 1000 and 1050 ms both match. That cannot distinguish a duplicate at the first completion from a genuine second completion.

For explicitly annotated completion windows `[900,1100]` and `[1900,2100]`, the intended answer is one match, one miss, one extra. Total-count equality alone would hide that failure.

This stand-alone reproduction retains the old function's executable logic:

```js
const assert = require('node:assert/strict');
function matchCycles(events, cycles, toleranceMs = 300) {
  const used = new Array(cycles.length).fill(false);
  let matched = 0;
  for (const e of events) {
    const i = cycles.findIndex(([s, end], k) => !used[k] && e.tMs >= s && e.tMs <= end + toleranceMs);
    if (i >= 0) { used[i] = true; matched++; }
  }
  return { matched, missed: cycles.length - matched, extra: events.length - matched };
}
assert.deepEqual(
  matchCycles([{tMs:1000,frameIndex:30},{tMs:1050,frameIndex:32}], [[0,1000],[1000,2000]]),
  {matched:2,missed:0,extra:0}
);
```

The corrective task requires predeclared completion windows, explicit overlap handling, one-to-one event matching, real runtime input/provenance validation, empty-data BLOCKED behavior, source-family split enforcement, and null rather than invented zero timing when no clock is measured. Countable-frame losses and lock-loss events must have separate units.

## Footage source review

RepCount is NOT adopted for this pilot. Its [primary source](https://svip-lab.github.io/dataset/RepCount_dataset.html) says Part A is YouTube-derived and Part B includes junior-school students and teachers. The page reports 1,451 videos and 19,280 annotations, but it does not establish per-clip reuse permission for this commercial-product R&D. Part B is excluded; Part A rights remain unresolved. Code licences and third-party mirrors are not footage-rights evidence.

Selected first pilot: [DVIDS Body Weight Squat, item 517502](https://www.dvidshub.net/video/517502/body-weight-squat), 32 seconds, VIRIN `170316-M-UV922-016`. The source explicitly marks it PUBLIC DOMAIN and credits the U.S. Marine Corps (caption: Cpl. Amber Jennings; page metadata: Joshua Pena). Its [use notice](https://www.dvidshub.net/about/copyright) retains privacy/publicity, trademarks and nonendorsement limitations. This is source review for a bounded internal pilot, NOT legal clearance or advertising permission.

Fallback: [Bodyweight Squats.gif](https://commons.wikimedia.org/wiki/File:Bodyweight_Squats.gif), own-work credit Danielflefil, CC BY-SA 4.0. Preserve attribution, licence/change notes and applicable share-alike obligations. Its short loop is one source family, not many independent examples.

Out-of-domain pipeline fallback only: [Squat — exercise demonstration video.webm](https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm), FitnessScape, CC BY 3.0. This is weighted-squat footage; it cannot establish bodyweight-squat accuracy.

## Actual work now required by the issued task

Build and run a local-only extractor against the pinned MediaPipe 0.10.35 lite model and actual current adapter/counter imports. Preserve original frame presentation timestamps and aspect ratio, reset at real shot boundaries, and distinguish offline processing speed from iPhone throughput. Compare frozen, r5-tracker/frozen-rules, and r6 on identical observations.

Freeze provisional visual labels before examining predictions. Report full visible cycles, partial/unscorable segments, startup misses, source group, source/model/runtime/config hashes, and per-event misses/extras. No tuning of r6 during the first pilot. No claimed holdout result: the first source is calibration/pipeline evidence only.

Footage/decoded pixels/pose arrays are temporary scratch inputs, never committed or exposed in the hosted preview. No member video, model training, public publishing, new account, purchase, backend or production contribution work is authorized. Keep live r6 source unchanged.

## Limits at this checkpoint

Director-runtime public-video downloads failed (DNS/transport); that is not evidence the source is unavailable in Lovable's execution environment. No real-video result is claimed by this checkpoint. The executing worker must return the actual replay receipt or exact access/decoder blocker. Source inspection, independent scoring review, worker-run video tests, hosted access and physical-device acceptance remain separate evidence states.
