#!/bin/bash

resolve_sqlc() {
  if command -v sqlc >/dev/null 2>&1; then
    command -v sqlc
    return 0
  fi

  if [ -n "${GOBIN:-}" ] && [ -x "$GOBIN/sqlc" ]; then
    printf '%s\n' "$GOBIN/sqlc"
    return 0
  fi

  local go_path
  go_path="$(go env GOPATH 2>/dev/null || true)"
  if [ -n "$go_path" ] && [ -x "$go_path/bin/sqlc" ]; then
    printf '%s\n' "$go_path/bin/sqlc"
    return 0
  fi

  return 1
}

require_sqlc() {
  local purpose="$1"
  local sqlc_bin
  sqlc_bin="$(resolve_sqlc)" || {
    printf '❌ sqlc is required for %s. Install v1.31.1 with:\n' "$purpose" >&2
    printf '   go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1\n' >&2
    exit 1
  }
  printf '%s\n' "$sqlc_bin"
}
