#!/usr/bin/env bash
# Starts the backend in watch mode and rebuilds the extension on change.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f apps/backend/.env ]; then
  cp .env.example apps/backend/.env
  echo "Created apps/backend/.env from .env.example (AI_PROVIDER=mock). Edit it to use a real provider."
fi
pnpm --filter @douala-ai/backend dev &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null || true' EXIT
pnpm --filter @douala-ai/extension exec vite build --watch
