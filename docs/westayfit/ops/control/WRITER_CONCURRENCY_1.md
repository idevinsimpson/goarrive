# WRITER-CONCURRENCY-1: only writer runs hold the writer concurrency group

**Authority:** queue #365 `6078735066`, release `6078863846`, L0's scope answer #394 `6078737368`. Owner W4.

**Base:** `main` at `df8d4d69f41f70971c5918c36d776b9af07d1bcb`. Source-only. Nothing is dispatched or deployed here.

## The gap

`wsf-control-reconcile.yml` ran every event in one fixed concurrency group, `wsf-control-writer`. GitHub keeps one running and one pending run per group, and a newly queued run cancels the pending one. Every `issue_comment` anywhere in the repository starts this workflow. That includes a comment on a PR and the App's own render edit.

Such a run queued in the writer group, cancelled the pending writer run, and then skipped at the reconcile job's `if`. The decision or worker block behind the cancelled run waited for the next qualifying comment or the `:13`/`:43` cron.

One sequence from 2026-10-09:
- run `37915019580` (10:01:31Z) was an owner comment on #394, a writer run, and it was pending;
- the next run queued in the group was `37915038477` (10:01:42Z), a comment on PR #601, which skips at the job `if`;
- the writer run ended `cancelled`.

Runs from comments on #578 (`37913246532`, `37913707091`, `37914764543`) did the same. The queue cites `37913030558` and `37915019580`.

## The change

`.github/workflows/wsf-control-reconcile.yml`, the workflow-level `concurrency` only:

- **`group`** is an expression of the form `(<the reconcile job's if, word for word>) && 'wsf-control-writer' || format('wsf-control-skip-{0}', github.run_id)`.
  - A run whose writer job will run holds the writer group, exactly as before.
  - Every other run takes a group of its own, keyed by its run id, so it never waits on or cancels a writer run. That covers:
    - a comment by anyone other than the owner;
    - the App's own comments and edits;
    - a comment outside the six inboxes;
    - an edit by a non-owner;
    - a `pull_request` event on its `refs/pull/*` ref;
    - a dispatch from a non-main ref.
- **`cancel-in-progress` stays `false`.** A writer run that is already pushing is never killed.
- **Unchanged:** the triggers, the job `if`, the environment, permissions and steps, and the `fastpath-dispatch` job. That job runs in the same run as the writer job, so it shares that run's group.

Writer runs still coalesce among themselves: a newer writer run replaces an older pending one. That stays safe for the reason in `AUTONOMY_ARCHITECTURE_1B_1C.md` §2.3 item 2: each run re-derives everything from fresh facts.

This note refines that document's line "Workflow `concurrency: {group: wsf-control-writer, cancel-in-progress: false}`". The group is now that name only for writer runs.

## Tests

In `tools/wsf-control/tests/shadow.test.mjs`:

- **The pin that held the fixed group** (formerly `:1116`) now pins:
  - one workflow-level group written as a `${{ }}` expression;
  - `cancel-in-progress: false`;
  - no job-level `concurrency`.
- **New test: "WRITER-CONCURRENCY-1: only a run whose writer job runs holds the writer group".**
  1. **No drift.** The group's condition must equal the job `if` (whitespace-normalized), and the throwaway group must be keyed by `github.run_id`. A change to one without the other fails.
  2. **Every event shape.** The group is evaluated alongside the `if`:
     - owner comments on the six inboxes, an owner self-edit, and `schedule`, `workflow_dispatch` and `workflow_run` on main get `wsf-control-writer`;
     - owner comments on PRs #578, #597 and #601, the App's comment and render edit, a non-owner's edit of an owner comment, a collaborator's comment, `pull_request` on `refs/pull/601/merge`, and a dispatch from another ref get `wsf-control-skip-<run_id>`.
  3. **The failure itself, on GitHub's queue rule.** Run in order: a decision, a worker block, a PR comment, then an App edit. A fixed group cancels the worker block; the new group cancels nothing. Writer runs still coalesce.

**Results** (Node 20, at the delivered head):

| Check | Result |
|---|---|
| `tools/wsf-control/run-all.mjs` | **all suites passed**, shadow **73** (72 on `main`, plus the new test) |
| Fail-first | the new pin rejects the original fixed-group workflow |
| GitHub's own expression engine (`@actions/expressions` 0.3.61) | group and `if` agree on all 20 event shapes |
| `actionlint` 1.7.7 | clean |
| Workflow mutants (8) | **all killed**:<br>• the group drifts (a dropped clause; an inbox only in the `if`);<br>• the main-ref guard is dropped from the group;<br>• the throwaway group is shared;<br>• the branches are swapped;<br>• `cancel-in-progress: true`;<br>• a job-level group is added;<br>• the fixed group is restored |

## After merge

The writer pins both `tools/wsf-control` and `.github/workflows/wsf-control-reconcile.yml`, and this change touches both. At the merge commit, `writerPinProblem` therefore stops the writer from recording anything until an owner `set-contracts` decision re-pins the `writer` and `writer-workflow` contracts at that commit. L0 posts that decision. The writer records it through its re-pin path, and normal recording resumes.
