# GoArrive Existing Documentation Index

## Overview
The repository contains several documentation files from different phases of development. This index maps each document to its purpose and current relevance.

## `.claude/` Directory
| File | Purpose | Current Relevance |
|---|---|---|
| `agent_messages_schema.md` | Schema definition for the `agent_messages` Firestore collection, used for cross-bot huddles. | **High** — Active schema for the Huddle v2 system. |

## Root-Level Documents

| File | Purpose | Current Relevance |
|---|---|---|
| `unified-blueprint.md` | The original unified blueprint (v2.0) covering all 20 sections of the platform. | **High** — Canonical reference for product vision, data model, and architecture. Some sections describe planned features that are not yet built. |
| `firebase.json` | Firebase configuration for hosting, functions, Firestore, and storage. | **High** — Active configuration file. |
| `firestore.rules` | Firestore security rules. | **High** — Active security rules. Must be updated when new collections are added. |
| `firestore.indexes.json` | Composite index definitions. | **High** — Active index configuration. |
| `storage.rules` | Firebase Storage security rules. | **High** — Active security rules for media uploads. |

## `docs/` Directory

| File | Purpose | Current Relevance |
|---|---|---|
| `blueprint.md` | Earlier version of the product blueprint. | **Low** — Superseded by `unified-blueprint.md`. |
| `current_one.md` | Notes on current development priorities. | **Medium** — May contain useful context but should be cross-referenced with `.claude/current-state-and-roadmap.md`. |
| `DATA_MODEL_MIGRATION_GUIDE.md` | Guide for migrating data models between versions. | **Medium** — Useful if schema changes are planned. |
| `PHASE_1_2_VALIDATION_REPORT.md` | Validation report for phases 1 and 2. | **Low** — Historical reference only. |
| `PHASE_2_3_SUMMARY.md` | Summary of phases 2 and 3. | **Low** — Historical reference only. |
| `RISK-001-cts-pif-discount-stacking.md` | Risk analysis for CTS/PIF discount stacking. | **Medium** — Relevant when working on billing logic. |
| `goarrive-workout-system-review-*.md` | Workout system review documents (versions 12, 13, 14). | **Medium** — Useful for understanding the evolution of the workout system design. |
| `week5-loop3-polish-assessment.md` | Polish assessment from week 5, loop 3. | **Low** — Historical reference only. |
| `workout-e2e-test-checklist.md` | End-to-end test checklist for the workout system. | **Medium** — Useful when building or testing workout features. |
| `jane_uid.txt` | Test user UID for Jane. | **Low** — Development reference. |

## Root-Level Notes (Historical)

| File | Purpose | Current Relevance |
|---|---|---|
| `CTS_STRIPE_FIX_SUMMARY.md` | Summary of CTS Stripe integration fixes. | **Low** — Historical reference for billing debugging. |
| `PROMPT_*_LOOP_ASSESSMENT.md` | Development loop assessment documents. | **Low** — Historical development process notes. |
| `admin-gate-notes.md` | Notes on admin gating logic. | **Low** — Historical reference. |
| `implementation-notes*.md` | Implementation notes from development sprints. | **Low** — Historical reference. |
| `rules-audit-notes.md` | Notes from Firestore rules audit. | **Medium** — Useful when reviewing or updating security rules. |
| `doc-comparison-notes.md` | Notes comparing different documentation versions. | **Low** — Historical reference. |

## Recommended Reading Order for New Agents
When starting work on GoArrive, an AI agent should read the documentation in the following order.

First, read `CLAUDE.md` in the repository root for the high-level overview and core rules. Then, read the `.claude/` directory files in this order: `product-identity.md` for brand and vision context, `architecture-and-stack.md` for technical foundation, `data-model.md` for database understanding, `coding-patterns.md` for implementation guidelines, `file-map.md` for navigating the codebase, `current-state-and-roadmap.md` for understanding what exists and what is planned, and finally `do-not-build.md` for guardrails.

For specific feature work, consult `cloud-functions-reference.md`, `billing-and-business-rules.md`, `scheduling-and-integrations.md`, `build-system-vision.md`, `design-system.md`, `known-issues-and-lessons.md`, and `testing-and-quality.md` as needed.
