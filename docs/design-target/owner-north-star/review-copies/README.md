# Owner boards — review copies and concept panels

**The originals are untouched.** Everything here is derived from them, and
every file says what it came from. Regenerate with:

```
node scripts/westayfit/owner-board-review-copies.mjs
```

The script asserts the board is 1448×1086 before it cuts anything. The panel
grid is declared, not detected, so it is correct for *these* boards and would
fail loudly rather than quietly mis-cut a replacement.

## Provenance

| Copy | From |
| --- | --- |
| `OWNER-BOARD-1-before-current-wsf-experience-review-1200w.jpg` | `../OWNER-BOARD-1-before-current-wsf-experience.png` (1448×1086, 1.9 MB) |
| `OWNER-BOARD-2-after-target-wsf-vision-review-1200w.jpg` | `../OWNER-BOARD-2-after-target-wsf-vision.png` (1448×1086, 2.5 MB) |
| `CONCEPT-1..6-*.png` | crops of the AFTER board, each the phone plus its own numbered caption |

The review copies are 1200px JPEGs at ~200–270 KB, for opening quickly in a
browser or a comment thread. **They are not the reference.** Any question of
colour, detail or intent goes to the original PNG.

## The six concepts, and what each can truthfully become

The AFTER board is a **visual** reference, not a data contract. Several of
these six draw things the product cannot ship. Each row pairs the concept with
what it can be — the full rule set is in `../README.md`.

| # | Concept | Ships as drawn? | What changes, and why |
| --- | --- | --- | --- |
| 1 | Community Home | Mostly | The face row and `Morgan added 20 · 2h ago` cannot: no invented faces, and contributions are never attributed publicly. `+20 squats · 2h ago` is the true form. `23 members` is fine where the product is authorized to read a member count. **Accepted and implemented** as Page 1. |
| 2 | Add contribution | Mostly | `Your update would move the community to 261 / 500` is a predicted shared total that concurrency cannot guarantee. Show the member's own amount; the new total appears after it is confirmed. **Accepted and implemented** as Page 2. |
| 3 | Contribution confirmation | Mostly | Same prediction rule; plus the face row and `12 people contributed today`, which is a unique-person count. The celebration itself — the big WE, the confirmed number — is real and is built. **Accepted and implemented.** |
| 4 | Community / join | Partly | `A happier, healthier Smyrna` is a health claim. The photography is authorized community photography where it exists, not stock people. `23 members already moving together` is a member count, not a count of who moved. |
| 5 | Profile / personal impact | **Largely not** | `45 squats this week`, `3 contributions this week`, `6 day streak` and `Added 20 squats · 2h ago` all need private dated history, which no callable returns and `firestore.rules` denies. The photo and the quote have nowhere to come from. `You helped move the community from 216 to 261` is arithmetic over a window containing everybody who wrote in it, so it is not a claim this product may make. `Workouts` and `Friends` are not destinations. See `review/page-05-you/`. |
| 6 | Quick check-in / challenge | Partly | The movement grid implies a fixed catalog; the product's retained set is the seven units with counting guidance (`ACTIVITY_GUIDES`), with free text beside them. The face row and `12 people checked in today` are the same two rules as #1 and #3. |

**Concept 5 is the one to read carefully before any You work.** It is the most
attractive panel on the board and the one with the least behind it.
