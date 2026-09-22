# W2 — independent visual audit of the North Star board package

This directory holds the work of **W2 (visual evidence auditor)** for the
We Stay Fit Round 1 parallel sprint. It is an *audit*, not a board.

Nothing in here is a design deliverable. W2 does not author boards, does not
revise them, and does not clear the director's gate. W2 opens the pixels that
were already delivered, compares them against the lock verdicts recorded on
PR #365, and returns a recommendation with evidence attached.

## Contents

| File | What it is |
|---|---|
| `AUDIT-2026-09-22.md` | The audit: per-board verdict, every defect with its file, crop and the lock line it violates. |
| `crops/` | Crops cut from the delivered PNGs to show a specific defect. Each filename names the board and the defect it illustrates. |

## Scope boundary

W2 writes only under `docs/design-target/north-star-final/review-audit-w2/`.
The boards themselves, the frozen review screenshots, the generator scripts,
the package README and INDEX are read-only here. Any change W2 believes the
package needs is written up as a **proposal** in the audit and in the PR body,
with a suggested one-writer assignment, and is left for the lead to apply.
