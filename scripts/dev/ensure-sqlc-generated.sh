#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SENTINEL="$ROOT_DIR/packages/adapters/pkg/db/db.go"

needs_generation=false
for file in \
  "$ROOT_DIR/packages/adapters/pkg/db/db.go" \
  "$ROOT_DIR/packages/adapters/pkg/db/models.go" \
  "$ROOT_DIR/packages/adapters/pkg/db/users.sql.go"; do
  if [ ! -f "$file" ]; then
    needs_generation=true
    break
  fi
done

if [ "$needs_generation" = "false" ]; then
  changed_source="$(
    find "$ROOT_DIR/packages/infrastructure/postgres/sqlc" "$ROOT_DIR/packages/infrastructure/postgres/sqlc.yaml" \
      -type f \
      -newer "$SENTINEL" \
      -print \
      -quit
  )"
  if [ -n "$changed_source" ]; then
    needs_generation=true
  fi
fi

if [ "$needs_generation" = "true" ]; then
  "$ROOT_DIR/scripts/dev/generate-sqlc.sh"
fi
