#!/bin/bash
# Setup git hooks for GoArrive
# Run this after cloning the repo: ./scripts/setup-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/hooks"
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "❌ hooks/ directory not found. Are you in the repo root?"
  exit 1
fi

echo "📦 Installing git hooks..."

for hook in "$HOOKS_DIR"/*; do
  hook_name=$(basename "$hook")
  cp "$hook" "$GIT_HOOKS_DIR/$hook_name"
  chmod +x "$GIT_HOOKS_DIR/$hook_name"
  echo "  ✅ Installed $hook_name"
done

echo ""
echo "✅ Git hooks installed successfully."
echo "   Hooks will run automatically on git operations."
echo "   To skip: use --no-verify flag"
