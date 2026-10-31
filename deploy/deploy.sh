#!/usr/bin/env bash
# Pull both repos and rebuild the stack. Run on the VPS from /opt/ai-cinema/AI-_Cinema_BE/deploy.
set -euo pipefail
BRANCH="${1:-main}"
cd "$(dirname "$0")"
git -C .. fetch --quiet && git -C .. checkout --quiet "$BRANCH" && git -C .. pull --quiet --ff-only
git -C ../../AI_Cinema_FE fetch --quiet && git -C ../../AI_Cinema_FE checkout --quiet "$BRANCH" && git -C ../../AI_Cinema_FE pull --quiet --ff-only
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps
