# We Stay Fit — Releases

Append-only release log. Each entry: date, milestone, staging channel URL, functions deployed, GoArrive-unchanged proof, PR link.

## Format

```
## YYYY-MM-DD — M-XX <title>

- Branch: <branch-name>
- Anchor SHA: <origin/main SHA at dispatch>
- Head SHA: <branch HEAD SHA at deploy>
- Hosting: <channel URL>
- Functions deployed: <list>
- GoArrive-unchanged proof:
  - `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` → EMPTY
  - `firebase functions:list` before/after → all pre-existing GoArrive functions present
- PR: <URL>
- Notes: <anything worth flagging for the next milestone>
```

## Entries

## 2026-08-26 — M-U1 App Shell & Infrastructure

- Branch: `feat/westayfit-foundation`
- Anchor SHA: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf` (origin/main at dispatch)
- Head SHA: (see PR at merge time)
- Hosting: <https://westayfit-app--staging-x4m0iwln.web.app> (channel `staging`, expires 2026-09-03)
- Functions deployed: `westayfit:wsfHealth` (v2 callable, us-central1, Node 20, auth-required)
- GoArrive-unchanged proof:
  - `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` → EMPTY
  - `firebase functions:list --project goarrive` before: 125 functions; after: 126 functions; delta = `+wsfHealth`, no removals
  - `npm --prefix apps/goarrive run ts:check` → exit 0
- WSF checks:
  - `npm --prefix apps/westayfit run ts:check` → exit 0
  - `npm --prefix apps/westayfit run test:vitest` → 5/5 tests pass (4 smoke + 1 zero-custom-claims guard)
  - `npm --prefix apps/westayfit run build:web` → 4 static routes (`/`, `/health`, `/_sitemap`, `/+not-found`), WSF meta injected into all HTML files
  - `npm --prefix apps/westayfit run test:e2e` (vs channel URL) → 4/4 tests pass (home render, health render, unknown-route 404 with no GoArrive leak, axe no serious/critical)
- PR: (opened, do NOT merge)
- Notes:
  - Initial axe run failed on eyebrow color `#e8b547` gold on `#f7f5f0` cream (contrast 1.73:1 vs WCAG 4.5:1 required). Fix: swapped eyebrow to `theme.colors.primary` (`#0B1F3A`), rebuilt, redeployed, axe green.
  - Zero-custom-claims guard implemented via `git grep` at test time against `functions-westayfit/` and `apps/westayfit/` (excluding the guard itself and `docs/westayfit/**`).
  - `inject_meta.py` walks `dist/*.html` so all static routes get the meta (not just `index.html`).
  - Root `firebase.json` change limited to appending one `functions` array entry (`{ source: "functions-westayfit", codebase: "westayfit" }`). Hosting block untouched.
