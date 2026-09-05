# WE STAY FIT — MASTER SOURCE OF TRUTH

**Version 1.1 · 2026-09-05 · Owner: Devin Simpson (devin.simpson@goa.fit)**

This is the governing document for We Stay Fit (WSF). It is written to be read by
**Claude Code, ChatGPT, Maia, and Manus** as well as by people. When any of them
is asked to do WSF work, this document governs.

It consolidates and supersedes, as a reading requirement:

| Source | Date | Standing now |
|---|---|---|
| *We Stay Fit Universal Communities — Product, Architecture, Lovable Charter* | — | **Lovable/Supabase scope only.** Brand copy in it is superseded. |
| *We Stay Fit Claude Code PM Handoff* | 2026-08-26 | **Superseded** by the 2026-08-31 revision. Architecture still valid. |
| *…PM Handoff, Revised* | 2026-08-31 | **Governing** for brand, messaging, coach model, milestone names. |
| *We Stay Fit × FitLife Expo 2026 Strategic Brief* | 2026-09-01 | **Governing** for the FitLife activation (§8). |

You do not need to read those four to act. You do need to read this.

---

## 0. PRECEDENCE — read this before resolving any disagreement

Three separate hierarchies. Do not mix them.

**Product and business truth**
1. Devin's explicit current decision
2. This master document
3. The 2026-08-31 revised PM handoff
4. `docs/westayfit/DECISIONS.md` (accepted decisions)
5. The accepted milestone plan
6. Conversation transcripts and brainstorming — **advisory only**

**Technical truth**
1. Current remote `main` and its exact SHA
2. Currently deployed staging and production artifacts
3. Live database schema, Firestore rules, functions, permissions
4. Repository documentation
5. Agent memory — **never authoritative**

**Deployment truth**
> A deployment without a receipt does not exist. A merge is not a deployment. A build is not a staging release. A staging release is not production.

Every release receipt names: PR/branch · commit SHA · build source · what changed
(functions/rules/db) · hosting target · URL · tests · smoke results · rollback anchor.

### When sources conflict

Do **not** silently reconcile. Stop the affected part of the task, name the conflict
precisely, say which source governs which dimension, recommend the safest resolution,
record it as a risk or dependency, and wait for Devin when the decision touches
product, money, privacy, security, or rollout.

An idea that appeared in a transcript is not a rule. Capture it as a decision needed,
a risk, a dependency, a configurable placeholder, or a Post-MVP item.

---

## 1. BRAND AND MESSAGING — current, with the supersessions that matter

Source: 2026-08-31 revised handoff §1.1 and Appendix A.1, recorded in `DECISIONS.md`.

**Wordmark:** WE STAY FIT

**Primary tagline — exact punctuation:**
> Turn your community into a place that moves.

**Supporting line — supporting use only, never a substitute for the tagline:**
> Shared challenges. More movement. Stronger communities.

### Superseded — do not reintroduce

| Line | Status | Why |
|---|---|---|
| "Wherever your people gather, We Stay Fit." | Superseded as core sentence | Replaced 2026-08-31 |
| "Your place. Your people. Your move." | Superseded | Replaced 2026-08-31 |
| "Start a community. Choose a challenge. Invite your people." | **Not the primary explainer** | Makes the reader feel responsible for starting or recruiting. May describe an optional path only. |
| The word "participation" as brand copy | Rejected | Too institutional |
| Apartment-specific framing | Rejected | Narrows the product |

⚠️ **Both documents Devin attached on 2026-09-02 contain superseded brand copy.** The
Universal Communities charter and the 2026-08-26 PM handoff both lead with "Wherever
your people gather" and "Start a community. Choose a challenge. Invite your people."
Their **architecture, boundaries and guardrails remain valid**; their **brand copy does
not**. If you are reading either of those files directly, apply this section over them.

### Interpretation rules

- **Joining must feel as complete as starting.** This is the reason the old explainer
  was rejected. Never build or write a funnel where "Start" is the real path and "Join"
  is a footnote.
- Center the real-world place or existing group when natural — without narrowing WSF
  to apartments or excluding less place-bound communities.
- WSF is not "another social workout app." It **activates an existing community around
  shared movement**.
- Do not make AI the hero. The relationship between people, communities and coaches is
  the product.

### Vocabulary

**Always:** We Stay Fit · GoArrive · coach · member · fitness coaching · online ·
technology-enabled · community · Community Champion · Founding Champion · community
challenge · Move Marker · movement (not exercise) · Command Center (GoArrive coach
dashboards)

**Never:** trainer · personal training · virtual training · "client" in member-facing
copy · owner of a neighborhood · exclusive owner of a community · "official partner"
without an agreement · "partner community" without an established relationship ·
"launching soon" without an approved schedule · "coming soon" as a substitute for an
unfinished workflow

### Physical product

**We Stay Fit Move Marker.** Supporting phrase: **Tap. Move. Join.**

---

## 2. PRODUCT

### North star

> Turn your community into a place that moves.

WSF helps people activate fitness, movement, accountability and connection inside the
communities they **already belong to**: a neighborhood, a street or block, an apartment
or condo community, a workplace, a church or ministry, a family, a friend group, or
another custom community.

No gym required. No coach required to begin. No kiosk required. No organizational
contract required for a person to start or join a community-created group.

### Product hierarchy — never reverse this

1. Community
2. Challenge
3. Members
4. Joining, invitations, and sharing
5. Community page
6. Movement and progress
7. Physical touchpoints
8. Organization verification
9. Optional community coaching and events
10. Optional individualized GoArrive fitness coaching
11. Optional Interactive Station or kiosk

Do not make coaching the first question. Do not make the kiosk the product. Do not make
organizational sales approval the only way a community can begin. Do not lead the
consumer funnel with "get your own coach," "schedule a sales call," "apply for a pilot,"
"talk to a property manager," "buy a kiosk," or "complete a fitness assessment."

### The simplest valuable version

Someone starts or joins a community → they get a community page → they choose or move
with an approved starter challenge → they invite their people by link or QR → adult
members join → members participate and check in → the community becomes more active
together.

> A person should be able to start with a name, a challenge, a link, a QR code, and
> their people. **Everything else is an upgrade.**

### Roles inside a community

`Visitor` · `Founding Champion` · `Co-Champion` · `Member` ·
`Verified Organization Administrator` · `We Stay Fit Staff` · `GoArrive Coach`

Do not collapse these into one overloaded "admin." Do not put a staff role in a
member-editable profile. Do not let a Champion or organization rep self-verify.

### Founding Champion, not owner

The first person to start a community is its **Founding Champion**. They do **not** own
the neighborhood, street, property, business, church, geography, community name, or every
future WSF group in that area. Never permanently reserve a geographic area to one person.
Never block another group from existing in the same area.

### Community types

`neighborhood` · `apartment` · `workplace` · `church` · `family` · `friends` · `custom`

Defaults by type — invite-only by default for workplace, church, custom; private and
not publicly searchable for family/friends; location-based with the exact address hidden
for neighborhood and apartment. Resident-led creation is allowed for apartments without
property-management approval; an official property relationship requires later
verification.

### Boundary with GoArrive — this one is load-bearing

**We Stay Fit provides:** community creation, membership, approved community challenges,
group-level movement, community accountability, community pages and sharing, QR codes,
aggregate participation, optional community programming, optional organization
verification, physical touchpoints later.

**GoArrive provides:** individualized intake, tailored workouts, individual progression,
one-to-one feedback, higher-touch accountability, the coach–member relationship,
scheduling, billing, the Workout Player.

Do not duplicate GoArrive coaching inside WSF. Do not put individualized coaching at the
top of the community funnel. Approved lower-page language: *"Want more individual
support? Individualized GoArrive fitness coaching is available separately for members
who want a personal intake, a tailored plan, individual feedback, and deeper
accountability."* Do not imply it is included with a free community.

**Never build through the community product:** medical plans, rehabilitation plans,
diagnosis-based workouts, injury-specific prescriptions, individual nutrition plans,
medication guidance, or personalized progression presented as coaching.

### Coach opportunity (approved direction, 2026-08-31)

A coach may serve as an optional **recurring group coach or fitness presence**, helping
many people at a weekly, twice-monthly, monthly or other approved cadence. The community
experience is an easier front door than asking someone to buy individualized coaching
immediately. Affordability comes from **scale and product structure, not from lowering
coach value**.

**Not approved by that decision:** specific pricing, compensation, payment flows, session
frequency, or organization agreements.

---

## 3. ARCHITECTURE — three surfaces, one identity

| Surface | Purpose | Domain | System |
|---|---|---|---|
| **WSF public site** | Marketing, SEO, discovery, B2B, Expo entry | `westay.fit` | Lovable + Supabase |
| **WSF product** | Authenticated communities, members, challenges, check-ins, Champion controls | `app.westay.fit` | `apps/westayfit` + Firebase |
| **GoArrive** | Individualized coaching and the coach operating system | `goarrive.fit` | `apps/goarrive` + Firebase |

> Lovable introduces We Stay Fit. The We Stay Fit app runs the community. GoArrive
> provides the optional individualized coaching engine. GitHub remembers the truth.

Deep-link from public CTAs into `app.westay.fit`. **No blanket redirect from
westay.fit. No iframe. No hidden dual system.**

### System of record — the no-dual-write rule

**Lovable/Supabase owns:** public marketing and SEO content, multifamily and neighborhood
inquiry leads, B2B pipeline, public pricing content when approved, community candidates
during transition, Champion interest campaigns during transition, association claims
during transition, Expo marketing experiments.

**Firebase / WSF product owns:** authenticated adult member identities, community groups,
memberships, Champion permissions, invitations, challenge templates, community challenges,
challenge moves, check-ins, community settings, member display and privacy choices, the
Champion dashboard, Move Marker destinations later, organization links after conversion,
the GoArrive coaching handoff.

**GoArrive owns:** the individualized coaching relationship, tailored plans, coach–member
communication, individual programming, Workout Player content and playback, scheduling,
coaching billing.

> **Supabase and Firestore must never co-own the same active community or membership.**
> No permanent real-time sync to preserve prototypes. Existing Lovable Champion data
> converts through a staff-reviewed action or stays a historical pre-activation record.
> No automatic bulk conversion without an approved migration and identity-matching plan.

### Do not use Lovable for new permanent implementation of

Supabase Auth for community members · community memberships · member profiles · challenge
check-ins · Champion dashboards · member directories · community workouts as a second
fitness-content system · private community access · paid community subscriptions · Move
Marker administration.

Keep the existing Champion architecture. **Gated, not deleted.**

### GoArrive rules that WSF work must not break

Three global roles only — `platformAdmin`, `coach`, `member`. **No fourth Firebase
custom-claim role for Champion**; community role lives in membership documents. Use
`effectiveUid` / `claims.coachId` where GoArrive requires it. Preserve tenant isolation in
Firestore rules. camelCase in Firestore and TypeScript. Stage before production. Never
silently rename existing collections. Do not refactor the Workout Player for WSF's
convenience.

⚠️ **Deploy hazard, learned the hard way:** `firebase deploy --only firestore:rules`
replaces the **entire live ruleset, GoArrive's included**. `firestore.indexes.json` has
the same semantics and can also propose deleting indexes. Never run either without a
live-vs-repo drift check first. WSF hosting deploys use `firebase.westayfit.json`
(site `westayfit-app`); `firebase.json` is GoArrive.

---

## 4. WHO DOES WHAT

| Classification | Owner | Examples |
|---|---|---|
| PM / Architecture | **Claude Code** | Audit, milestone design, risk review, acceptance, roadmap, prompts |
| Code task | **Maia** | Application code, rules, tests, migrations, PRs, staging deploys |
| Stateless browser task | **Maia** | Public-site testing, Playwright, visual QA without a personal login |
| Stateful dashboard task | **Manus** | Firebase Console, DNS, Google Cloud, Stripe, Resend, authenticated consoles |
| Product decision | **Devin** | Scope, pricing, brand, visual verdict, production authorization, legal |
| Hybrid | Split | Claude defines the split; Maia codes; Manus does dashboards; Devin decides |

Every response to a routed task **starts with its classification**. Every implementation
prompt names the owner and the boundary. Never send the same feature to Lovable and Maia
for production implementation at the same time.

### The rule Claude Code keeps breaking

> **Claude Code should not become a second implementation agent by default.** Claude Code
> may write product code **only when Devin explicitly assigns Claude Code as the
> implementation owner for a named milestone.** One milestone has one production code
> owner.

*Recorded honestly: this rule was violated during the M-U2 window. Claude Code wrote four
commits Maia could have been deploying, and the live site fell behind the branch as a
direct result. Legitimate exceptions are verification runs that genuinely need Claude
Code's environment — not implementation drift.*

### Truth gate — post before every milestone

Milestone · Task classification · Implementation owner · Repository · Worktree · Branch ·
HEAD · origin/main · Working tree status · Current staging source · Current production
source · Relevant feature gates · Relevant rules/database version · Plan status · Devin
approval status.

If a value is unknown, say **unknown** and go retrieve it. Never continue from memory. If
HEAD is not on the expected main lineage, **stop**.

### PM sweep format

`PM sweep — <date/time>` → Shipped/verified · In progress · Blocked · Decisions needed
from Devin · Risks · Next highest-value action · Production state · Staging state.

Do not narrate every internal thought. **Do not hide a blocked state behind optimistic
language.**

### Terminal verdicts

`ACCEPTED` · `CONDITIONALLY ACCEPTED` · `REJECTED` · `BLOCKED` — then evidence, then the
exact next action.

### Evidence labelling

Every claim is labelled **EMULATOR VERIFIED** or **LIVE VERIFIED**. Never cite a health
endpoint, a build stamp, or a test run as deploy evidence without checking it is real.

---

## 5. MILESTONE ROADMAP — and the numbering conflict, resolved

The three source documents use **the same identifiers for different milestones**. The
2026-08-31 revision flags this itself (Appendix A.3). Resolution:

> **The Firebase product roadmap below governs `apps/westayfit`.** The Lovable charter's
> roadmap governs Lovable only. Where `docs/westayfit/MILESTONES.md` disagrees, this table
> is correct and MILESTONES.md needs updating — **which requires Devin's sign-off, not a
> silent edit.**

| ID | Name | Primary workflow |
|---|---|---|
| M-U0 | Architecture & Transition Audit | Plan only. No product code. **CLOSED 2026-08-26** |
| M-U1 | App Shell & Infrastructure | The WSF app builds and deploys without changing GoArrive. **MERGED** (`79df0d4`) |
| M-U2 | Adult Member Identity & Community Foundation | An authenticated adult creates a gated private community and becomes its Founding Champion. **IN FLIGHT** |
| M-U3 | Invitation and Join | A Champion invites a second adult, who joins the private community. |
| M-U4 | Starter Challenges and Check-ins | A Champion starts an approved challenge; a member checks in. |
| M-U5 | Community Home & Champion Controls | A community operates from one useful page. |
| M-U6 | Universal Start and Join Funnel | A visitor chooses Join or Start and reaches the right flow. |
| M-U7 | Expo Mode | A booth visitor starts or joins and continues securely on their phone. |
| M-U8 | Organization Verification & Conversion | A resident-created group links to a verified organization without erasing Champion history. |
| M-U9 | Move Markers | A Champion creates a safe reusable QR touchpoint. |
| M-U10 | Public Launch & Monetization Readiness | Approved features become safe for production traffic. |

**Known conflict, unresolved:** repo `MILESTONES.md` currently labels M-U3 "Interest → App
Bridge" and M-U4 "Champion Campaigns Landing Surface." Those names come from the Lovable
lineage. **Decision needed from Devin** — see §10.

### Release discipline

One major workflow per milestone. Never combine app shell + auth + community creation +
challenges + Expo mode + Move Markers + monetization in one loop.

Every code milestone: typecheck → relevant tests → build → deploy to the **WSF staging
target** → stateless browser checks → staging URL → Devin's visual/device verdict.
**Production requires Devin explicitly authorizing that named release.**

Security-sensitive milestones need runtime evidence, not just unit tests: denied
unauthorized access, successful controlled actions, role isolation, token hashing,
transaction behaviour, public payloads, feature gates. Synthetic evidence data is labelled
and removed afterward.

---

## 6. SECURITY AND PRIVACY — non-negotiable

### Never collect in the community product

Diagnoses · medications · injury history · medical records · weight · BMI · body
measurements · wearable feeds · exact GPS trails · background location · child information
· individualized coaching plans · individual nutrition plans.

### Never expose

Member emails · phone numbers · private group membership · private check-ins · private
event locations · home addresses · organization contacts · staff notes · consent records ·
token hashes.

Public group pages show **aggregate** counts ("18 members participating"). No automatic
member directory. Members choose their display name and visibility. The Founding Champion
does not automatically receive everyone's contact information. Organizations receive
aggregate information unless a member separately consents.

### Adults only, first release

No child accounts, minor profiles, school accounts, youth-leader access, parent-managed
child profiles, child location tracking, child health information, or public child names.
A family challenge may involve children offline; no child identity is stored.

### Authorization

Never trust browser-supplied group ownership, membership role, organization authority,
challenge authority, or invitation relationships. Derive from the authenticated user, an
active membership, a valid one-time capability, a stored foreign key, or an approved staff
action. Founding Champion authority is assigned **atomically** at creation. Raw invite
tokens are never stored — hash them. Never print a raw administrative token on a physical
product.

### Truthfulness

Every fictional community is flagged `isSample` and visually marked. Sample data never
appears in real engagement counts, admin KPIs, sales claims, public traction claims,
testimonials, or marketing statistics. **Never invent** members, participation,
organization approvals, outcomes, renewals, revenue, testimonials, or locations
represented as real customers.

Never claim health improvement, weight loss, property retention, employee productivity,
church growth, financial ROI, property value, or leasing outcomes without verified
research and approved claim language.

### Legal gate

Public account creation stays feature-gated until approved: Privacy Policy, Terms of Use,
collection notices, retention schedule, adult-account rules, community conduct rules,
Champion responsibilities, organization-verification rules, moderation and removal rules,
rights-request handling, abuse and rate-limit plan, incident escalation, physical product
terms. **Never promote a `pending-approval-*` consent version to approved without explicit
approval. Never invent legal language.**

---

## 7. CREDENTIALS AND SECRETS

- Firebase `AIza…` web API keys and Stripe `pk_live`/`pk_test` are **publishable by
  design** — not secrets. Access control lives in Firestore Rules.
- Everything else — provider API keys, service-account JSON, tokens — goes in **Secret
  Manager**, never in a `.env` that could be committed, never in plaintext function
  config, never pasted into Slack or a chat transcript.
- **Removal is not remediation.** A credential that reached a public branch must be
  **rotated**, on the assumption it was harvested.
- Do not modify either of Devin's own accounts.

---

## 8. FITLIFE EXPO 2026 — the first WE STAY FIT LIVE implementation

Source: Devin's strategic brief, 2026-09-01, from his own review of FitLife's 2026 site.
Figures and site claims below are **his research — verify before spending money or making
a commitment.**

**FitLife EXPO · Sunday, October 11, 2026 · 12:00–5:00 PM · Alpharetta City Center,
Alpharetta, Georgia · 1,500+ expected attendees.**
*Date verified as a Sunday. As of 2026-09-02 that is **38 days out**.*

### The strategic correction — this governs everything about FitLife

FitLife has **already built** the community experience. Their event includes free fitness,
interactive demos, health screenings, family activities, giveaways, music, a JumboTron,
the One Step Closer Breast Cancer Walk, a pet parade, a food drive, vendors, and a
nonprofit Community Impact Zone. Their own FAQ describes activities intended to bring the
community together, accessible regardless of fitness level.

> **We Stay Fit is never positioned as fixing FitLife.**

**Never say:** "FitLife is just booths" · "we're going to make FitLife interactive" ·
"we're going to create community at FitLife" · anything implying FitLife needs WSF to get
people moving.

**Say instead:** "You're already…" · "I love what you've already built…" · "What if we
connected…" · "What if we gave people another way…" · "Could we build this together?" ·
"I don't know what's possible, but imagine…"

### The actual position

> FitLife already creates the experiences. We Stay Fit connects participation **across**
> those experiences.

An attendee scans a QR code and joins. Activities they were already going to do — a
fitness class, the walk, a vendor demo, moving with their family, a community-impact
activity — become challenges inside one shared experience. Each completion advances a
**shared FitLife community goal**.

**The emotional idea:** *"I did that"* becomes *"We did that."*

### Working event identity — NOT approved

**FITLIFE MOVES · powered by We Stay Fit.** Working name only. Co-branding requires Jan's
agreement.

### The live community goal

Something visible all day showing what FitLife is accomplishing together — participants,
challenges completed, percent toward the goal.

> ⚠️ **Do not lock a goal number into the product.** "2,000 challenges" is illustrative.
> The scoring system is not finalized. The **product principle** is what's fixed:
> *individual participation must visibly advance community progress* — someone completes
> something, looks at the display, the number changes.

### The two kiosks

Two kiosks are secured. Their experiences are **not designed yet** — storyboard both
before development.

- **Kiosk 1 — Participation:** join, see available challenges, choose something, scan, see
  what's next.
- **Kiosk 2 — Community Pulse:** live progress, participants, challenges completed, percent
  to goal, recent activity, milestones, encouragement, rotating prompts.

Roles are hypotheses, not final.

### JumboTron — opportunity, not an assumption

FitLife advertises a JumboTron. Live community progress on it would make the shared goal
expo-wide. **Access is NOT confirmed** — FitLife lists a dedicated JumboTron sponsorship at
$5,000, so display access should not be assumed to come with an exhibitor space. Approach
collaboratively.

### The vendor opportunity — possibly the strongest part

Challenges could involve existing exhibitors: visit a participating vendor, try their
activity, scan their QR, challenge complete. This changes the pitch from *"give We Stay Fit
more exposure"* to *"can We Stay Fit help attendees engage with more of what you've already
built?"* WSF stops competing for attention and starts distributing it.

### Footprint — DO NOT DECIDE YET

Published options: **$550 Team Exhibitor**, **$975 MVP Exhibitor**; the vendor agreement
asks 10×10 vs 10×20 and electricity needs.

Do not buy the larger footprint because it sounds better. First answer: how much of the
experience can extend beyond our footprint · what role the JumboTron can play · whether
vendors can participate · what must physically happen inside our own space · the actual
dimensions of the two kiosks · queueing space · whether FitLife requires kiosks fully
inside the purchased footprint · electricity for both · surrounding equipment. **Then**
decide whether the extra $425 buys real experiential capability.

### Questions for Jan — explore, don't fire off as a checklist

Could attendees encounter challenges outside our footprint? Could participating vendors
opt in? Could existing FitLife activities count? Could QR markers appear at selected
locations? Could live progress appear on the JumboTron? Could the emcee announce
milestones? Could FitLife help introduce the idea beforehand? Is there an event map to
design around? Would FitLife co-brand as "FitLife Moves powered by We Stay Fit"? What
would FitLife need from us operationally? Given the concept, which footprint do they
recommend?

The posture is **curious, excited, collaborative, respectful** — not "I've figured out how
to improve your expo."

**The one-sentence fallback if the conversation gets away:**
> "You've already created all these ways for people to move and participate at FitLife;
> We Stay Fit could connect those experiences through shared challenges and give the whole
> community one goal they're working toward together."

### Build WE STAY FIT LIVE, not a FitLife booth

Do not design "the We Stay Fit FitLife booth." Design **WE STAY FIT LIVE** — a reusable
format of which FitLife is the first implementation: two kiosks, mobile challenge
experience, community progress engine, QR participation system, portable signage, challenge
templates, live community display, event administrator controls, portable activation kit,
replaceable event branding.

`FITLIFE MOVES` later becomes `COMPANY MOVES`, `APARTMENT COMMUNITY MOVES`, `CHURCH MOVES`,
`CITY MOVES`, `CONFERENCE MOVES`, `CAMPUS MOVES`. Software and kit stay substantially the
same; the community changes.

> **Money spent now should create reusable We Stay Fit Live infrastructure, not
> FitLife-specific disposable materials.**

### Expo honesty rules

Back-office work may stay manual — organization verification, duplicate review, physical
product follow-up, custom challenge requests, coach assignment, commercial follow-up — **if
it is honestly represented. Do not disguise manual operations as automated.**

No fake national activity map. No fabricated counts. No fake community locations. No
unlabelled sample groups. Expo mode must auto-reset, leave no personal data on the screen,
expose no visitor tokens in browser history, save no form values between visitors, and
grant no admin access. **The kiosk must never become the only way to use the platform.**

### What success actually means

Not "we got leads." Evidence that: people understood how to join · joined without extensive
explanation · completed challenges · completed more than one · interacted with experiences
outside our footprint · cared about collective progress · were encouraged by seeing progress
· moved together · vendors saw value · the organizer saw value · community leaders
understood how it could work in their own communities.

Then we can credibly say: *"At FitLife, ___ people joined together and completed ___
challenges toward one shared goal."* **That is proof.**

---

## 9. CURRENT STATE — 2026-09-02

**Verify before relying on this section. It ages.**

| | |
|---|---|
| Repository | `idevinsimpson/goarrive` |
| `origin/main` | `79df0d4` |
| Active WSF branch | `claude/westay-fit-takeover-cont-c6ye55` |
| WSF app | `apps/westayfit` (Expo Router) — routes: index, signin, signup, verify-email, profile-setup, start-community, community/[groupId], health |
| WSF functions | `functions-westayfit` — `wsfHealth`, `wsfCreateCommunity`, `wsfSendVerificationEmail` |
| Feature gate | `EXPO_PUBLIC_WSF_AUTH_ENABLED` (`apps/westayfit/src/featureFlags.ts`) |
| Hosting | site `westayfit-app` via `firebase.westayfit.json`; Firebase project `goarrive` |
| Milestone | M-U2 in flight, accepted READY-BUT-GATED; PR #300 open |

**Open defects on the member journey:** verification email does not deliver (WSF now sends
via Resend — configuration pending), and the Firebase Auth action URL points at a route
that does not exist. Resend has exactly one verified sending domain (`goarrive.fit`);
`westay.fit` is not yet in the account.

---

## 10. OPEN DECISIONS — Devin only

Claude Code, ChatGPT, Maia and Manus **may not decide these**. Surface them; do not
improvise.

### Time-boxed — these have lead times and get worse if they wait

| # | Decision | Needed by | Why the date |
|---|---|---|---|
| **A** | **Email path.** Finish `westay.fit` in Resend, or ship on the already-verified `goarrive.fit` sender as an interim? | **Now** | Every day this sits, E2–E6 accumulate as code no real person has walked. It is the only thing standing between us and a validated member journey. |
| **B** | **Check-in verification** — honour system, per-location QR, or mixed? | **~Sep 14** | QR means codes printed and placed, and vendor coordination. It is the strongest part of the FitLife concept and the one with a physical lead time. |
| **C** | **Verified email before joining?** | **Before E2 lands** | At the booth, "scan → sign up → go find your email → come back" costs most of the funnel. Built as a one-line guard either way; defaulting to requiring it. |

**Blocking now**
1. ~~**Milestone numbering**~~ — **RESOLVED 2026-09-05.** Firebase roadmap adopted; `MILESTONES.md` rewritten with the Lovable-lineage names recorded as superseded and that work moved to Post-Expo.
2. **Email configuration** — Resend sender address on `westay.fit` once verified; `WSF_APP_URL`; whether to ship on the already-verified `goarrive.fit` sender in the interim.
3. **Auth action URL** — the project-level setting is shared with GoArrive and may mean GoArrive password resets are also broken.
4. **PR #300** review.
5. **Credential rotations** — the Browser Use key on public `main`; the `maia@goa.fit` password posted in cleartext; the July Anthropic key.
6. **Favicon / brand mark** — WSF ships no icon. Not to be invented.

**FitLife, decide before Oct 11**
7. Booth footprint — 10×10 vs 10×20, $550 vs $975 (after the §8 questions are answered).
8. Co-branding "FitLife Moves powered by We Stay Fit."
9. Whether to pursue JumboTron access.
10. The shared goal number and scoring model.
11. Whether vendors can be part of the challenge network.

**Structural**
12. Public launch date · production deployment · pricing · paid-plan limits · Stripe merchant model for WSF · minor accounts · nutrition features · health-data collection · leaderboards involving body metrics · public member directory defaults · organization access to member identities · Move Marker vendor and pricing · refund policy · legal terms · privacy policy · retention schedule · exact Expo claims · whether to split into a separate repository · whether to use a separate Firebase project · major Workout Player refactor · activating current Lovable gates.

---

## 11. CHANGE CONTROL

This document changes only by Devin's decision. When it does:

1. Bump the version and date at the top.
2. Record what changed and why in `docs/westayfit/DECISIONS.md` with a unique ID — never restart numbering, never edit a historical meaning to make current work easier.
3. If the change supersedes copy or a decision, **say what it supersedes**, the way §1 does. A superseded line that is not named as superseded will come back.
4. Never delete an open question to tidy the document. **An open question is a finding.**

The companion logs stay authoritative for their own domains: `DECISIONS.md` ·
`RISKS.md` · `DEPENDENCIES.md` · `MILESTONES.md` · `RELEASES.md` ·
`CURRENT_STATE.md` · `ARCHITECTURE.md` · `DATA_OWNERSHIP.md`.

---

## 12. THE PRINCIPLE TO COME BACK TO

Do not build an expo gimmick. Build the first portable implementation of the core idea:

> **Turn your community into a place that moves.**
> Shared challenges. More movement. Stronger communities.

The community is the product. The challenge creates momentum. The Champion creates
distribution. The page creates belonging. The Move Marker creates a physical doorway.
GoArrive creates the optional individualized next level. The kiosk creates a premium
activation experience.

The job is to make that executable without creating three competing platforms, weakening
GoArrive, losing the Lovable work, reintroducing superseded messaging, inventing
unsupported economics, or letting Expo urgency overrule security and product truth.
