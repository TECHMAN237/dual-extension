#!/usr/bin/env bash
# Full verification: install, typecheck, tests, builds. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▶ pnpm install";        pnpm install --frozen-lockfile
echo "▶ typecheck";           pnpm -r typecheck
echo "▶ tests";               pnpm -r --no-bail test
echo "▶ build backend";       pnpm build:backend
echo "▶ build extension";     pnpm build:extension
echo "▶ live e2e";            node scripts/e2e-live.mjs
echo "✔ all checks passed. Extension: apps/extension/dist — Backend: apps/backend/dist"
