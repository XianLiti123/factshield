#!/bin/sh
# FactShield entrypoint: on first boot, seed the local data snapshot (accounts,
# sessions, checkpoints, vector stores, master key, attachments) into the runtime
# dirs so the cloud instance starts identical to the local machine.
# If a volume with existing data is mounted, seeding is skipped and cloud data wins.
set -e

SEED_SESSION=/app/seed/session
SEED_MEMORY=/app/seed/memory
SEED_WORKSPACE=/app/seed/workspace
RUNTIME_SESSION=/app/agent/session
RUNTIME_MEMORY=/app/agent/memory
RUNTIME_WORKSPACE=/app/agent/workspace

if [ -f "$SEED_SESSION/sessions.db" ] && [ ! -f "$RUNTIME_SESSION/sessions.db" ]; then
    echo "[seed] First boot detected: copying local data snapshot into runtime dirs..."
    mkdir -p "$RUNTIME_SESSION" "$RUNTIME_MEMORY" "$RUNTIME_WORKSPACE"
    cp -a "$SEED_SESSION/." "$RUNTIME_SESSION/"
    cp -a "$SEED_MEMORY/." "$RUNTIME_MEMORY/"
    cp -a "$SEED_WORKSPACE/." "$RUNTIME_WORKSPACE/"
    touch "$RUNTIME_SESSION/.seeded"
    echo "[seed] Local data snapshot seeded (accounts/sessions/knowledge/attachments)."
else
    echo "[seed] Runtime data already present, skipping seed."
fi

exec "$@"
