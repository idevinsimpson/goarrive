# Mobile workout Zoom candidate (not deployed)

The member remains on the authenticated workout link. On iPhone, Android and touch iPad, the gated workout overlay uses Zoom Meeting SDK Client View in a same-origin HTTPS iframe. Desktop keeps the existing Component View. The iframe provides Zoom's full meeting controls inside a 330-by-380-pixel panel; the workout remains mounted underneath. This is a responsive panel, not a promise of a customizable tiny camera-only tile or simultaneous audio mixing on every phone.

## Official support and limits

- Zoom explicitly directs mobile/tablet use to Client View and does not support Component View there: https://developers.zoom.us/docs/meeting-sdk/web/browser-support/
- Client View's import guidance explicitly supports iframe isolation from host CSS: https://developers.zoom.us/docs/meeting-sdk/web/client-view/import/
- HTTPS and iframe media permissions are required: https://developers.zoom.us/blog/meeting-sdk-iframe/
- No native Zoom app handoff or separate user-facing link is introduced. No backend policy, signature role, recording policy or meeting allocation changes.
- Real iPhone and Android camera/microphone delivery, usable control layout and coexistence with playlist audio still need device acceptance. Chromium with a phone-sized viewport is not that acceptance.

## Historical comparison

The preserved `SessionZoomTile` and `/join/[sessionInstanceId]` use Component View 3.11.2. The tile pre-warms camera/mic and then programmatically clicks Zoom controls after joining; its join has no 10-second deadline. Its loader includes React, ReactDOM, Redux, ReduxThunk and Lodash, plus older CSS. The primary legacy session join also links directly to the provider join URL. Devin's reported prior mobile success is valid; the available history does not identify which of those routes he used.

The new recorded overlay uses 5.1.4, explicit recorded consent, manual media controls and the gated signing purpose. Its signature source includes the appKey required by SDK5. Both SDKs remain participant role0. We do not restore synthetic camera/mic clicks or silently switch to the provider app.

PR657 separately addresses discarded errors and the overly short SDK timeout. This branch stacks on it but uses a supported mobile SDK view rather than presenting a timeout change as the mobile fix.

## Lifecycle and privacy

- No iframe or SDK loads before the existing explicit join/recording consent action and successful server admission.
- Only the exact parent/child window and same origin may exchange messages. Signature/config travel in memory via postMessage, never in URLs, browser storage or application logs.
- Child accepts one join. Full pinned Client View5.1.4 dependencies load in its own document. The standalone react-redux CDN path returns403; that library is bundled in5.1.4, so the adapter uses the verified available external dependency set.
- Previews and waiting-room previews are disabled. The application never invokes getUserMedia or synthetic media-control clicks. User operates Zoom's controls.
- Existing server admission polling/expiry and recording consent remain. Navigation, closing, denial or timeout removes the isolated browsing context, including hung SDK operations. The iframe's SDK leave navigates only to a same-origin receipt page that closes the parent-owned frame.
- Export postprocessing excludes these isolated HTML pages from app service-worker registration/automatic reload; normal app routes keep existing behavior. Static files contain no private session data.

## Evidence

556 app tests and TypeScript checking passed. Tests cover mobile selection, exact-origin/window messaging, no opt-in/no SDK, late cancellation, redaction, React overlay integration and existing desktop behavior. A separate Python export test preserves iframe isolation while still injecting the worker into ordinary routes.

Actual public CDN script load in fresh headless Chromium succeeded with zero capture calls; init/join were deliberately not called. A separate fully synthetic SDK browser run showed iframe controls and workout interaction together, zero live requests/capture calls, and frame removal on Leave. Neither is live meeting acceptance.

## Current test failure remains distinct

The reported phone attempt received six successful signer HTTP responses, but the UI discarded the exact SDK rejection. Allocator source requests approval_type0 (registration with automatic approval) without supplying a registrant token; current effective provider settings have not been read, so this remains a separate hypothesis. The no-show job later marked the test missed at18:00:44UTC, blocking retries before its18:25 end. No attendance restoration, new booking, meeting/access-policy change or production deployment is included here.
