#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/dev/sqlc-tool.sh
source "$ROOT_DIR/scripts/dev/sqlc-tool.sh"

SQLC_BIN="$(require_sqlc "generating shared Go database code")"

echo "🧬 generating shared sqlc code with $("$SQLC_BIN" version)..."

find "$ROOT_DIR/packages/adapters/pkg/db" -maxdepth 1 -type f -name '*.sql.go' -exec rm -f {} +

(
  cd "$ROOT_DIR/packages/infrastructure/postgres"
  "$SQLC_BIN" generate -f sqlc.yaml
)

echo "✅ shared sqlc code generated"
