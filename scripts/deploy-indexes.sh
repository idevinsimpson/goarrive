#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy-indexes.sh — Deploy Firestore indexes and Cloud Functions
#
# Suggestion 7: Ensures composite indexes for recurringGroupId, recurring_schedules,
# notification_cooldowns, and workout_logs are deployed to production.
#
# Prerequisites:
#   - Firebase CLI installed: npm install -g firebase-tools
#   - Authenticated: firebase login
#   - Cloud Scheduler API enabled (for continueRecurringAssignments):
#     gcloud services enable cloudscheduler.googleapis.com
#
# Usage:
#   ./scripts/deploy-indexes.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  GoArrive — Deploy Firestore Indexes & Cloud Functions      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Deploy Firestore indexes
echo "→ Deploying Firestore indexes..."
firebase deploy --only firestore:indexes
echo "  ✓ Firestore indexes deployed"
echo ""

# Step 2: Ensure Cloud Scheduler API is enabled (required for scheduled functions)
echo "→ Checking Cloud Scheduler API..."
if command -v gcloud &> /dev/null; then
  if gcloud services list --enabled --filter="name:cloudscheduler.googleapis.com" --format="value(name)" 2>/dev/null | grep -q cloudscheduler; then
    echo "  ✓ Cloud Scheduler API is already enabled"
  else
    echo "  → Enabling Cloud Scheduler API..."
    gcloud services enable cloudscheduler.googleapis.com 2>/dev/null && \
      echo "  ✓ Cloud Scheduler API enabled" || \
      echo "  ⚠ Failed to enable Cloud Scheduler API — enable it manually:"
    echo "    gcloud services enable cloudscheduler.googleapis.com"
  fi
else
  echo "  ⚠ gcloud CLI not found — please verify Cloud Scheduler API is enabled:"
  echo "    https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com"
fi
echo ""

# Step 3: Ensure App Engine app exists (required by Cloud Scheduler in some regions)
echo "→ Checking App Engine app (required by Cloud Scheduler)..."
if command -v gcloud &> /dev/null; then
  if gcloud app describe 2>/dev/null | grep -q 'id:'; then
    echo "  ✓ App Engine app exists"
  else
    echo "  → Creating App Engine app (us-central region)..."
    gcloud app create --region=us-central 2>/dev/null && \
      echo "  ✓ App Engine app created" || \
      echo "  ⚠ Could not create App Engine app — create it manually in Firebase Console"
  fi
else
  echo "  ⚠ Skipping App Engine check (gcloud not available)"
fi
echo ""

# Step 4: Deploy Cloud Functions (includes recurring assignments + cooldown cleanup)
echo "→ Deploying Cloud Functions..."
firebase deploy --only functions
echo "  ✓ Cloud Functions deployed"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Deployment complete!                                       ║"
echo "║                                                             ║"
echo "║  Indexes may take several minutes to build.                 ║"
echo "║  Monitor progress in Firebase Console > Firestore > Indexes ║"
echo "╚══════════════════════════════════════════════════════════════╝"
