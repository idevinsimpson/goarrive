# Real-video benchmark: first executed pilot and independent review

Checkpoint: 2026-10-04 UTC, after VIDEO-BENCHMARK-1 execution.
Scope: isolated research only. Not production integration, a model-training run, held-out accuracy acceptance, or a new iPhone performance pass.

## What actually completed

Lovable project `c1b16a13-34ff-4878-b798-750cc63aa595` completed the first real-video extractor and replay at commit `d5bb51603f8eec840ea880caedf42a8f43b2a4e0`. The completed assistant response and saved run report were read, not inferred from a task acknowledgment.

Execution request: `umsg_01m423hg9gfr9aaxdacyvrg8em`, main thread, sent 2026-10-04T00:03:11Z. Completed response: `main:agent#00000000003133#don:L2OZHNUY`.

The Director inspected the full diff against the design-only predecessor `e9d5f452da7d58d7f014106af25e71e76b38c538`. Changes are confined to the benchmark evaluator/test, local scripts and benchmark documentation. The live r6 camera page, r5/r6 counting algorithms, frozen core and model package were not changed by this task. There was no publication or access change.

## Real clip and provisional labels

Source: [DVIDS Body Weight Squat, 517502](https://www.dvidshub.net/video/517502/body-weight-squat), VIRIN `170316-M-UV922-016`, official Marine Corps exercise demonstration. The source marks the work PUBLIC DOMAIN subject to its [use restrictions](https://www.dvidshub.net/about/copyright). Publicity/privacy rights, trademarks and nonendorsement restrictions are retained. This is an internal source-reviewed pilot, not legal clearance or marketing permission.

The implementation run reports these measured inputs:

- Original video SHA256: `05b5870da6ebc66abcfd5715a2864e21299d176dc2c87524d3f5904c37450f66`.
- 7,669,079 bytes; 1024 × 576; 978 video frames; 32.6326 seconds; audio ignored.
- Same pinned MediaPipe Tasks Vision 0.10.35 lite model, CPU explicitly requested and used; actual live `mapBlazePose` and three actual counter-session implementations.
- Original presentation timestamps preserved; all frames processed offline. This is NOT real-time phone frame-rate evidence.

The implementer inspected timestamped contact sheets and labelled five visible cycles before the model run. Completion anchors: 19,000 / 22,000 / 25,000 / 28,000 / 31,000 ms. Predeclared scoring windows extend 250 ms before and 600 ms after each anchor and do not overlap. One continuous shot; initial/final fades noted. Labels are single-review/provisional, not independently visually verified by the Director and not a certified WSF movement-quality judgment.

## Saved inference results — implementer-run, independently checked event arithmetic

| Counter path | Expected | Detected | Matched completions | Misses | Extras |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen tracker and rules | 5 | 5 | 5 | 0 | 0 |
| r5 tracker, frozen rules | 5 | 5 | 5 | 0 | 0 |
| r6 tracker and movement rules | 5 | 5 | 5 | 0 | 0 |

Actual saved event times in milliseconds:

- Frozen and r5/frozen: `18852.167, 21888.533, 24958.267, 27927.9, 31031`.
- r6: `18752.067, 21788.433, 24858.167, 27827.8, 30930.9`.

Each path reports one lock-loss event, attributed by the implementer to the final fade-out; zero timestamp-gap/out-of-order frames. The model reported 19 frames with no pose and zero with two or more poses. Measured CPU inference p50 was 55.4 ms and p95 73.7 ms on the worker's headless desktop; extraction wall time was 79.1 seconds. Those measurements must not be represented as an iPhone throughput result.

The raw run report is retained in the Lovable project at `docs/movement-vision/benchmark/runs/dvids-517502.cpu.json`; labels and source manifest are next to it. Temporary video, decoded frames and pose-array scratch files were deleted by the implementer after the run. No member footage was used or collected.

## Independent verification by the Director

The earlier six scoring/validation counterexamples remain documented in `VIDEO_BENCHMARK_REVIEW_2026-10-04.md` at GitHub `a45b2d98629b92d11140b3d949b1509860c774cc`.

After delivery, the Director executed unchanged source-function bodies from the new scorer, using Node 22.16.0 after TypeScript type erasure. Eight checks passed:

1. A duplicate count in the first completion window no longer hides a missed second completion: one match, one miss, one extra.
2. Overlapping completion windows are refused.
3. Chronological one-to-one event matching preserves duplicates as extras.
4–6. Independently recomputing the three saved event lists against the provisional label windows reproduces five matches and zero misses/extras for each arm.
7. Unmeasured timing stays null and nearest-rank percentiles behave as declared.
8. Empty frames and wrong model hashes are refused.

This is independent source-function/event-arithmetic QA. It is NOT an independent rerun of video decoding, pose inference, live browser behavior, or visual annotation.

Four remaining runtime-validation counterexamples were also reproduced: a nonnumeric aspect value, negative presentation timestamp, null pose-array entry, and labels beyond track duration were accepted by `validateTrack` at d5bb. These were returned to Lovable for repair, not marked passed.

## Review findings being addressed next

The first runner was tailored to its first clip: score.ts hard-coded 1024 × 576 and a minimum 32.633-second duration, and copied the source hash from its manifest rather than a measured decoder receipt. Those values matched this pilot, but would misrepresent a different clip. Its decode.sh also erased a caller-specified output directory; that must be replaced by bounded new scratch-directory handling before reuse.

The next bounded assignment requests actual source/dimension/duration/PTS receipts; source/model/config verification before inference; safe scratch paths; a nonzero exit on NOT RUN/invalid inputs; complete manifest/source-family validation; strict frame/landmark/timeline checks; and resource/network cleanup. These are harness repairs, not changes to the counter.

Continuation request: `umsg_01m4245wyjep59w62c8s8j33zx`, main thread, sent 2026-10-04T00:14:19Z. Read-back confirmed RUNNING at this checkpoint. The same assignment runs the source-reviewed [Wikimedia Bodyweight Squats.gif](https://commons.wikimedia.org/wiki/File:Bodyweight_Squats.gif), credited to Danielflefil under CC BY-SA 4.0, once at native timing, and re-runs the first clip. No artificial looping or fake standing lead-in; insufficient acquisition time must be reported rather than hidden. No second-source result is claimed by this checkpoint.

## Meaning and limits

We now have an executed real-video replay, not only a proposed benchmark. It establishes a useful basic pipeline on one straightforward, slow, single-person clip. It does not distinguish the three algorithms, explain Devin's remaining phone misses, establish fast-cadence/bystander reliability, or justify app integration.

RepCount remains a candidate with unresolved footage permissions; its school-participant subset is excluded and no RepCount footage was imported. No learned model has been trained. No held-out evaluation exists yet. The working r6 phone candidate stays unchanged while this separate benchmark work proceeds.
