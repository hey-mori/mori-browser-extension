#!/usr/bin/env bash
#
# Point this clone's git hooks at the tracked .githooks/ directory. Run once per
# clone; git never installs hooks by itself. CI checks a pull request's commit
# messages either way.
set -euo pipefail
cd "$(dirname "$0")/.."

git config --local core.hooksPath .githooks
echo "git hooks installed from .githooks/"
echo "  commit-msg: validates the message against the Mori commit format"
echo "  pre-push:   refuses a direct push to main"
