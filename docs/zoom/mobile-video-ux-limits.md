# Mobile workout video: supported slice and remaining limits

This change retains Meeting SDK Component View 5.1.4. It does not replace the SDK, request media automatically, or activate production video.

Implemented: the permanent Playbook link revalidates and opens one eligible current session directly; ambiguous candidates remain a choice. The session opens its server-resolved workout once, honoring authentication, timing, cancellation and completion. A large Camera entry opens the existing Zoom controls, with concise explicit cloud-recording consent. The small view uses the same rendered SDK root; it does not use display:none, recreate the client, or rejoin. Members expand it to use controls. Rendering recovery is separate from capture status.

Not implemented or claimed: automatic shrinking based on verified visible self-picture, a replacement large self-camera toggle, or removal of the built-in Share/view-picker toolbar. The documented Component View API has mute(), but no public self-camera start/stop method. Its customize.toolbar.buttons adds dropdown items; it does not replace built-in controls. Participant.video/isVideoConnect report camera/network state, not visible local pixels. There is no documented self-video DOM handle/frame-ready signal. Generic frame callbacks could belong to remote/helper video, and frame progress alone would not rule out the reported black preview. Per the later user request, the candidate shrinks once after six seconds of SDK camera-on. This is a UX timer, explicitly not proof of visible picture. Camera-off cancels the pending timer, and a manual size choice prevents later automatic shrinking. No extra confirmation notice is added.

Do not use synthetic toolbar clicks, private SDK DOM selectors, or automatic capture to fill these gaps. Options for later review: retain native SDK controls; ask Zoom for a supported self-view/control contract; or separately evaluate a supported alternative architecture. No alternative architecture is part of this release.

Evidence: the user confirmed their actual face was present in the recorded meeting, while live self-view was black. This is user-reported recording evidence, not an agent recording inspection. Rendering recovery tests and synthetic browser fixtures cannot establish physical iPhone/Android preview success.

Official references checked October 25, 2026:
- https://marketplacefront.zoom.us/sdk/meeting/web/components/modules/EmbeddedClient.html
- https://marketplacefront.zoom.us/sdk/meeting/web/components/interfaces/InitOptions.html
- https://marketplacefront.zoom.us/sdk/meeting/web/components/interfaces/Participant.html
- https://marketplacefront.zoom.us/sdk/meeting/web/components/functions/EmbeddedClient.updateVideoOptions.html

Proposed later release: Hosting only, built on the current production frontend with no backend, rules, runtime, SDK version, credential, account-security, booking or recording change. Review and release approval remain required. Real device acceptance must verify self-picture, native camera/mic controls, workout coexistence, small/expanded rendering and leave/rejoin with the member operating media themselves.

Responsive enlargement uses CSS zoom on the entire 320-by-240 SDK root, with matching outer layout dimensions. This magnifies native controls too, unlike canvas-only viewSizes changes; it does not crop or target private toolbar selectors. Scale is bounded by viewport width/height and a 1.5 maximum. Small view remains rendered at 0.45 scale and expands without rejoining. Actual native control hit areas and popovers still require real SDK/device acceptance; synthetic controls prove only the container geometry.

Microphone-on request: Component View documents mute(false), but no public initial join-computer-audio method or join option. Existing allocator sets mute_upon_entry:true. Changing that setting alone cannot establish browser audio; a native Join Audio action may still be necessary. This Hosting-only candidate does not change meeting policy or force unmute after a member deliberately mutes. Camera remains manual.
