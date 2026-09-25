# MOVEMENT-VISION-1: known limitations

These are stated plainly so nobody mistakes the lab for a finished capability.

## Director scope clarification (#475 comment `5825892708`)

The Director asked for these limits to be stated in this delivery. They are the rules the code follows, and where the code falls short, the limitation is written down:

- **Only full observed cycles count.** A rep is counted only when the counter itself observed standing, then down, then standing again (`squatCounter.ts`). A cycle that started before the lock, or in the `unknown` phase, cannot count. Tests: "starting in the down position counts nothing until standing is seen", "reset() … requires standing again".
- **A partial cycle is invalidated on loss.** Leaving `locked` for any reason calls `interrupt()`. That discards the rep in progress, and the member must be seen standing again (`session.ts`). Tests: "interrupt() mid-rep discards the rep", "lost tracking at the bottom voids that rep …", "while lost, nothing is counted …". The mutation check confirmed these tests go red if `interrupt()` becomes a no-op.
- **Pose ordering and nearest-candidate association cannot establish identity after full occlusion.**
  - The lock never uses the engine's pose order.
  - After a full occlusion or an absence, re-acquisition is still spatial: exactly one person, near the last box, holding still for 400 ms. That is a *heuristic*, not identity.
  - Whoever meets those conditions is treated as the member, even if it is a different person. Limitation 4 gives the details.
  - The lab shows "Lost you" during the gap; it cannot tell you who came back.
- **Synthetic crossings and fake-camera inference do not prove real-person lock or rep accuracy.** They show that the logic behaves as specified on known inputs, and that the real engine runs in a browser. Nothing more.

## Evidence limits
1. **It has not been tested on a real person squatting in front of a real camera.** This container has no camera and no human video. All counting evidence is either synthetic landmarks (unit tests and the lab's synthetic scene) or a fake camera feed made from a still photo. The squat threshold (depth 0.6, roughly hips about 60% of the way from standing to knee height) is a reasoned default, not a tuned one.
2. **No native support.** iOS and Android get the manual count only. See [`DECISION.md`](DECISION.md).
3. **The owner's hostile test set has not been run on a device.** It covers slow, fast and half squats; pauses; leaving and re-entering; walkers behind and in front; a second exerciser; poor lighting; and a moved phone. Each case exists as a synthetic unit test, and each unit test can fail. None has been run with real people.

## Subject lock: what it cannot guarantee
4. **No identity.** The lock follows a *position and size*, not a person. If the member leaves and someone else steps into the same spot at a similar apparent size within 4 s, while still enough to pass the 400 ms hold, that person is re-acquired as "the member". If two people swap places while overlapping, the lock goes `lost` (ambiguous). When exactly one person is left afterwards and holds still near the last position, they are re-acquired, whoever they are.
5. **It can only reason about people the engine detects.** MediaPipe lite missed a half-size person at the frame edge in testing. An undetected passerby cannot add reps, but an undetected person overlapping the member cannot trigger the ambiguity pause either. Instead they corrupt the member's own landmarks, and the counter sees whatever the engine reports.
6. **Engine duplicates are merged.** Two detections with box IoU ≥ 0.7 are treated as one person reported twice. Two real people almost perfectly overlapping, one directly behind the other at a similar size, would be merged too.
7. **A person standing close beside the member pauses counting** for as long as they stay. This is by design ("refuse rather than guess"), and it means two people cannot squat shoulder to shoulder in one frame.
8. **Acquisition needs the member standing, whole body in frame, centred, and still for 0.6 s.** Someone who starts mid-squat, or whose feet are cropped, is not locked. The UI says why.

## Counter: what it cannot guarantee
9. **It needs about 10 fps or more.** Down and standing each need 100 ms of consecutive samples, so at very low frame rates fast reps can be missed. Emulated-GPU browsers ran at about 1 fps; use `?delegate=cpu` there.
10. **Front-facing squats only have been reasoned about.** The shin-length signal also works in theory from the side, but has not been tested at other camera heights, at extreme angles, or with the phone on the floor looking up.
11. **Depth, not form.** It counts hip travel. It does not judge knee valgus, heel lift, back angle or anything else about form.
12. **A rep interrupted by lost tracking is discarded, never completed.** The member might feel a rep they did was not counted. That is the intended trade: a missed rep is better than an invented one.
13. **Occluded or cropped legs pause counting.** Legs cropped by the frame edge, or hidden behind furniture, give no measurable leg, so there is no depth and no count. BlazePose extrapolates off-frame joints; those are treated as not visible.
14. **Half reps are informational and noisy.** The "half reps seen" figure counts any excursion past depth 0.3 that did not reach 0.6, so jittery landmarks can inflate it. It never changes the count.

## Privacy and platform notes
15. **Two files are downloaded on first start.** They are the WASM runtime (jsDelivr) and the model (Google Cloud Storage). Both are fetched by the browser from public URLs; no frames and no data go with them. Both can be self-hosted with `EXPO_PUBLIC_WSF_MV_WASM_BASE` and `EXPO_PUBLIC_WSF_MV_MODEL_URL`.
16. **MediaPipe is pinned to 0.10.35 because 1.x sends usage metrics to Google.** Upgrading needs an owner decision (see [`DECISION.md`](DECISION.md)).
17. **Camera access needs HTTPS or localhost.** Testing on a phone needs the page served over HTTPS.
18. **Nothing persists.** Leaving the route, reloading, or pressing Reset loses the count. This is intended for this packet; nothing may reach the contribution path or the Living WE until the camera-vision layer is trusted.
