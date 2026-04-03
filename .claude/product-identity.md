# GoArrive Product Identity

## Core Vision
GoArrive (branded as G➲A) is an online fitness coaching platform and coach operating system. It is **not** a marketplace, a generic gym app, or a standard SaaS template. It exists to help independent fitness coaches run real businesses while giving members a premium, personalized coaching experience.

The platform follows a Keller Williams franchise philosophy. Coaches run their own client-facing businesses under the GoArrive umbrella, pay a tiered platform fee based on active-member volume, and can earn referral credits and profit-share distributions. The platform provides shared infrastructure, including payments, scheduling, and video hosting, so coaches can focus on coaching.

## The Three Roles
The platform operates on a strict three-role model enforced via Firebase Custom Claims.

| Role | Access Level | Description |
|---|---|---|
| **Platform Admin** | Full platform control | Can impersonate coaches to view and manage their tenants. Identified by `role: 'platformAdmin'` or `admin: true`. |
| **Coach** | Tenant-scoped | Operates within their own tenant, managing members and workouts. Identified by `role: 'coach'` and `coachId: <uid>`. |
| **Member** | Coach-scoped | Scoped to their assigned coach, accessing personalized plans and workouts. Identified by `role: 'member'` and `coachId: <coach-uid>`. |

*Note: There is no "CoachAssistant" or "Encourager" role in the current implementation. Do not build them.*

## The Core Product Loop
Every feature in GoArrive exists to support the core product loop. The coach builds a workout, the member plays the workout, the member reflects or journals on their experience, and finally, the coach reviews and responds.

Scheduling, billing, Zoom, reminders, plans, and analytics exist to support this loop, not replace it. 

Two reduction principles govern all product decisions. First, the product must reduce the steps from when a user opens the app to when they start the workout. Second, the product must reduce the steps from when a member finishes a workout to when their coach sees it.

## Product Language
GoArrive uses specific terminology that must be consistent across all surfaces.

| Use This Term | Instead Of | Context |
|---|---|---|
| **Coach** | Trainer | Used in all contexts referring to the professional guiding the user. |
| **Member** | Client | Used in all contexts referring to the user receiving coaching. |
| **Movement** | Exercise | Used when referring to the library assets used to build workouts. |
| **Online fitness coaching** | Virtual training | Used in marketing, descriptions, and general platform terminology. |
| **Command Center** | Dashboard | Used for coach-facing operating surfaces and overviews. |

Never expose backend jargon, such as allocation failures, room pools, raw statuses, or provider modes, in any user-facing copy.

## Savannah Bananas DNA
The product design follows five rules based on the Savannah Bananas' "Fans First" philosophy. The app must eliminate friction through one-tap joins and fast workout starts. It must entertain always, creating smooth and memorable finish moments. The platform must experiment constantly, driving iterative improvements to the coaching loop. It must engage deeply by enabling fast coach acknowledgment. Finally, the experience must empower action, building positive emotional momentum throughout the member journey.
