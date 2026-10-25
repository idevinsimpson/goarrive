# Recorded workout video acceptance candidate

Base: reviewed/deployed PR654 head 7e016d615b7c872a40a408333233a809a7a1ce5b. No deployment or real recording is performed by this candidate.

The actual owning UID may have role coach or platformAdmin. A different admin with a coachId claim cannot impersonate that owner; existing document ownership checks remain. No custom claims or roles change.

An optional recordingMode: cloud in the existing server-only test scope permits this exact bounded session to use recording. Omission retains none; local/unknown modes fail closed. The two-hour maximum, precise member/session/workout/coach bindings and general default-off remain. This does not implement indefinite rollout. A matching server-owned receipt must confirm live provider, participant video initially off, exact meeting/room/assignment/times and cloud recording. A writable recordingEnabled flag alone never authorizes it.

Admission returns recording mode and a non-secret binding including it. The new overlay explains cloud recording and requires an explicit Agree and join recorded video action. The signer checks the consent binding against fresh admission after all identity I/O, before generating a participant-only signature. It grants no host role. Binding changes tear down a joined client; retries require a new explicit click. No SDK/media load on mount and no automatic camera/microphone request are added.

For recorded test sessions, a routing wrapper prevents the legacy tile from mounting before the routing decision. It directs the member to Start Workout and the new consent-aware overlay. Expired cloud-test configuration remains routed away from legacy (without admission). Non-test recorded sessions keep the existing legacy tile after a successful routing response. Lookup errors fail closed with a refresh message. Removing the test configuration restores the existing legacy route; this is not universal Zoom revocation. Legacy /join and coach live-view remain unchanged.

## Live prerequisites and limits

The current test 1NRflRo91uy9t7KJXUYY had no room/receipt; its single allocation failed with No shared pool rooms available. No meeting was created. Do not retry allocation without a verified source. The live scope expires at 16:00 UTC October 25 and is not extended by this code.

User identified hmti2@goa.fit and Maia@goa.fit as the intended HMTI bot hosts. Read-only root metadata inventory found personal-email scaffold records in coach_zoom_connections, but neither bot mapped to zoom_rooms. Only one other coach's personal room exists. This does not prove the hosts are absent from Zoom. The existing allocator uses S2S credentials and rooms, not coach_zoom_connections. Its least-recently-used room ordering is not a transactional round-robin claim; the batch allocator also differs and room maxConcurrentMeetings is not enforced. Those issues need a separate allocation repair and tests, not fabricated mappings or a bulk allocation.

Existing getSystemHealth rejected the legitimate platformAdmin-role account because it checks token.platformAdmin instead. No retry/bypass and no secret read occurred. Actual provider membership/license permissions for the named hosts remain unverified. No new OAuth scopes/licenses/credentials are authorized here.

## Release boundary

Review first. Named functions only from reconciled source; do not deploy main wholesale, Connect, WSF, rules or indexes. Preserve PR650 merge hold. Any recorded test requires an explicitly authorized time window, verified host, recorded session/receipt, and manual participant consent. Real Android/Zoom recording acceptance remains pending and cannot be inferred from mocked UI or emulator tests.

Review correction: legacy entry rechecks routing immediately before joining and fails closed on errors or navigation. The signer enforces scoped recorded consent even when purpose is omitted, for every caller. The legacy tile has only an optional pre-join hook; unrelated callers and /join keep their behavior. Focused verification: 12 UI tests, 25 backend contracts, and both application and Functions type checks passed. No deployment performed.

