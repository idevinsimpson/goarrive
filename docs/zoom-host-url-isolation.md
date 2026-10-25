# Zoom host URL isolation — draft source repair

The Zoom provider returned `start_url` as `startUrl`. Both
`allocateSessionInstance` and `allocateAllPendingInstances` wrote that host
capability to `session_instances.zoomStartUrl`. Assigned members can read their
whole session document under existing rules; hiding a field in UI does not redact
the Firestore response. This is a source-confirmed unsafe path, not a verified
inspection of production records or proof of exploitation.

A repository-wide consumer search found no host UI using this field. This patch
therefore discards it from real/mock provider projections and removes it from
member-facing types/mocks. Both future allocator updates use a deletion transform
to remove an existing value on the occurrence being allocated. Existing reschedule
deletion remains. Participant join URL, password, meeting ID and room allocation
behavior remain unchanged.

No new host callable, storage, credential, grant or entitlement is introduced.
In particular, owning a session as its coach does not establish authority to host
the shared-pool Zoom meeting. Any future host feature needs a separate design
based on the actual server-recorded Zoom host/room entitlement.

Synthetic tests mock all provider network responses, inspect both actual allocator
update objects, and exercise full-document member reads with the existing rules.
The rules suite deliberately demonstrates that an untouched legacy host field is
still readable: **this patch does not remediate historical documents**. No live
record, secret, credential or host URL was read, generated, rotated or deleted.

This branch starts at merged main `666aca549af98e6fd4c07d0b2dedfb498d131b65` and
contains no PR647 permanent-link or workout-policy feature changes. No merge or
deployment is authorized here. A later approved release must rebuild Functions
from TypeScript (do not use stale tracked `functions/lib`), reconcile fresh live
inventory/source, and deploy only the reviewed named allocator Functions. Never
use broad default-codebase deployment or accept deletion prompts; WSF operational
main/source precautions still apply. Historical cleanup/credential remediation
requires separately defined scope and approval. Node runtime retirement remains
a separate operational gate.
