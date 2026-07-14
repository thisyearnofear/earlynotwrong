#!/usr/bin/env bash
#
# Deploy the agent to the production server (nuncio-vultr).
#
# The server's /home/linuxuser/earlynotwrong is a git checkout of this repo,
# so deployment is a pull + build rather than scp. This keeps the server in
# sync with git (no drift, easy rollback via `git checkout <prev>`) and avoids
# the stale-file mess that hand-scp used to leave behind.
#
# Usage:
#   ./deploy.sh                 # deploys origin/main
#   ./deploy.sh origin/main     # explicit ref (branch/tag)
#   ./deploy.sh ed104b07        # pin an exact commit SHA
#
# Build runs BEFORE the pm2 reload, so a failed build never restarts a
# working process. `set -e` aborts the whole script on any error.
#
set -euo pipefail

REF="${1:-origin/main}"
HOST="nuncio-vultr"
REMOTE_DIR="/home/linuxuser/earlynotwrong"

echo "→ Deploying ${REF} to ${HOST}:${REMOTE_DIR}"

ssh "$HOST" bash -s "$REF" <<'EOF'
  set -euo pipefail
  REF="$1"
  cd /home/linuxuser/earlynotwrong

  git fetch origin -q
  # Force-reconcile tracked files to the pinned ref. Untracked files (e.g.
  # .env, node_modules, local-only docs) are intentionally left alone.
  git checkout -f "$REF"

  # Build the shared conviction-core package first. It is consumed by the
  # agent via a file: dependency; npm ci for file: deps does not install
  # devDependencies, so we install + build it explicitly before the agent.
  cd packages/conviction-core
  npm ci
  npm run build
  cd ../..

  cd agent
  # Reproducible deps from the lockfile.
  npm ci
  # Rebuild from clean so removed sources don't leave stale .js in dist/.
  rm -rf dist
  npm run build

  # Zero-downtime restart; --update-env re-reads the process's saved env.
  pm2 reload earlynotwrong --update-env
EOF

echo "✓ Deploy complete"
