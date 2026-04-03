# GoArrive Do-Not-Build List

## Purpose
This document enumerates features, roles, and technologies that were part of earlier design documents (the "OG Blueprint") but have been explicitly rejected for the current and near-term product. Building any of these items without explicit approval from the product owner would constitute drift from the approved architecture.

## Rejected Items

| Item | Reason for Rejection |
|---|---|
| **CoachAssistant role** | The three-role model (platformAdmin, coach, member) is sufficient for current and foreseeable needs. Adding a fourth role introduces permission complexity without clear value. |
| **Encourager role** | This was envisioned as an accountability partner role. It is premature and can be implemented later as a simple share token if needed, without a full role system. |
| **MySQL / TiDB / Drizzle backend** | The Firebase stack (Firestore, Auth, Cloud Functions) is the correct and established backend. There is no relational database in this project. |
| **S3 for media storage** | Firebase Storage is the correct media storage solution. When the media pipeline is built, it must use Firebase Storage, not AWS S3. |
| **Zoom Embedded SDK** | External Zoom join links work reliably. The priority is building the workout player, not embedding Zoom. |
| **JotForm integration** | Replaced by the custom 8-step intake wizard (`intake/[coachId].tsx`). |
| **Calendly integration** | Replaced by the custom scheduling engine (recurring slots, session instances, Google Calendar sync). |
| **White-label / custom domains** | Premature optimization. The focus must remain on the core product loop before considering branding customization. |

## Guidance for New Features
When evaluating a proposed feature, apply the following test: does it directly improve the core product loop (coach builds workout, member plays workout, member reflects, coach reviews)? If the answer is no, the feature should be deprioritized or redesigned to align with the loop.

Features that add complexity without making the core loop smoother, clearer, faster, or more valuable should be flagged for review rather than built speculatively.
