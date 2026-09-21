# Context only — this is Home, not Community

These frames are `/community/[groupId]` as the product renders it today.

That route **is Home**: `app/index.tsx:377` does
`router.replace('/community/<groupId>')`, and the shell's Home tab matches
`p === '/' || p.startsWith('/community/')`. It is Page 1 — already targeted,
accepted and implemented, with its own BEFORE / TARGET / AFTER evidence in
`../../page-01-home/`.

They are kept here, apart from `../before/`, because they are **Page 1's
accepted AFTER**, not Community's BEFORE. Filing one page's accepted AFTER as
another page's BEFORE is exactly the mislabelled evidence that destroyed the
Page 2 comparison.

Nothing in this directory is evidence for or against the Community target.
