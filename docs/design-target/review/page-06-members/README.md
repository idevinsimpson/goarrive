# Page 6 · Members — PROPOSAL (no accepted target)

**Route:** `/community/[groupId]/members`, plus the first-arrival visibility
sheet that appears over `/community/[groupId]`.

**Status: implemented, NOT visually accepted.** This is the one implemented
route in the atlas with **no accepted design target** — the capability was
authorised before a frame for it was drawn, so there is no `TARGET-*` here to
match an `AFTER-*` against. `ROUTE-TARGET-INDEX.md` records the route as
uncovered for the same reason, and it should keep saying so until a target
exists or the owner accepts these frames as the direction.

Everything here is prefixed `ACTUAL-`, because that is what it is: captures of
the running product, offered as the proposal.

## The frames

Eight states, each at the three phone classes this atlas uses (`390x640`,
`390x844`, `430x932`) — 24 frames.

| Prefix | State |
| --- | --- |
| `ACTUAL-community-card-*` | `/community`'s current-community panel, with the compact Members preview |
| `ACTUAL-members-visible-*` | Members, the viewer visible and therefore in the list |
| `ACTUAL-members-private-*` | Members, the viewer private and therefore not in it |
| `ACTUAL-members-saving-*` | The write in flight, from a real click on the real control |
| `ACTUAL-members-savefailed-*` | A failed write — the callable is refused at the network edge, so this is the product's own path and not a mocked state |
| `ACTUAL-members-nobody-*` | A real community with real members, none of them shown |
| `ACTUAL-arrival-off-*` | The first-arrival sheet, toggle off, over a Home that still works |
| `ACTUAL-arrival-on-*` | The same sheet, toggle on |

Regenerate with:

```
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- \
  tests-e2e/design-members-proposal-capture.spec.ts
```

That spec is **not** in `gate1.sh` and must not be added: an ordinary run
should not pay for 24 rendered frames or rewrite committed evidence as a side
effect. The behavioural assertions live in `community-visibility.spec.ts`,
which does run in the gate.

## Compared against the North Star, element by element

Read against `owner-north-star/OWNER-BOARD-2-after-target-wsf-vision.png`,
`page-01-home/TARGET-home-390x844.png` and
`page-03-community/TARGET-list-several-390x844.png`.

| North Star property | Where these frames honour it |
| --- | --- |
| **Header rhythm: green eyebrow → name → count.** Home's target reads `YOUR COMMUNITY / Smyrna Strong / 23 members`. | Members reads `MEMBERS / Riverside Runners / 11 members`. The eyebrow names the feature so the **community** is still the largest thing on the page and there is no second headline competing with it. |
| **Navy is used selectively, for the important object on a screen** — the goal hero, the community-impact card, the challenge card. | The member list is a navy panel. It is the object this page exists for. An earlier version drew the whole page in cream cards and consequently had no centre of gravity, which is much of why it read as settings rather than as community. |
| **The community panel is composed as eyebrow-led sections** (`WHAT WE'RE DOING`, `RECENT MOVEMENT`). | `MEMBERS` is now one of those sections on the `/community` card, with a chevron and three previewed names, in the same eyebrow, the same green, the same weight. |
| **Minimal administrative copy.** The AFTER board carries none. | The whole page is a toggle, one sentence, the list, and one line saying why the list is the length it is. |
| **Privacy is stated inline, as a modifier — never as a card.** Home's target: `45 squats · private to you`. | The member's own control is one unweighted row on the cream ground: no border, no fill, no shadow, no heading of its own. It is visually subordinate to the navy panel by an order of magnitude. |
| **Exact wordmark and palette.** `PROGRESS_GREEN #91CB7D` for eyebrows and brand, `ACTION_GREEN #22C55E` for the thing a thumb is aimed at, navy `#0B1F3A` for weight, cream for ground. | The eyebrow is `PROGRESS_GREEN`; the toggle's on-state is `ACTION_GREEN`; the list panel is `NAVY`; the ground is `CREAM`. No colour was sampled off a board. |
| **Living WE only where it truthfully represents a confirmed shared-goal ratio.** | There is no Living WE on this page. A members list has no ratio, and drawing one would be the instrument lying. |

### Where earlier versions drifted, recorded so it is not repeated

Three successive versions drifted the same way, and the pull is worth naming
because it feels like diligence: **each was trying to prove the privacy
guarantee in the interface.** Privacy climbed the hierarchy until it was the
page title (`Who is here`), the first card, the list's eyebrow (`WHO CHOSE TO
BE NAMED`), the footer, *and* a status line wedged into the community panel
between the community's name and its first section. A members list had become
a settings screen wearing a list, and the community panel was narrating a fact
about the reader inside an object that is entirely about the community.

The guarantee does not need proving on the screen. It is enforced in
`functions-westayfit` and pinned by tests that fail when it is removed.

`Who is here` was also simply the wrong words: it reads as live presence, and
this product tracks nobody's presence.

## What is deliberately absent from these frames

Each of these would be a leak rather than a nicety, and each is asserted
absent by a test:

- **No count of the visible list** beside the community's member count. The
  header prints `memberCount` over every active member; a second number makes
  "how many are hiding" a subtraction the product performs for the reader. The
  `Show more` control carries no count for the same reason.
- **No avatars, initials or monograms.** No photo is collected in this slice,
  and a generated initial is a second identifier beside a name.
- **No joined date, no "active recently", no ordering but the name.** When
  somebody became visible turns a list into a timeline.
- **No tap target on a row.** A name here leads nowhere, so a pressable row
  would promise a member profile that does not exist.
- **No search.** A field answering "is Sam in this community" is a lookup
  oracle over a list somebody joined for the opposite reason.
- **No uid anywhere**, including in the pagination cursor, which is an integer
  offset rather than a Firestore document cursor.
