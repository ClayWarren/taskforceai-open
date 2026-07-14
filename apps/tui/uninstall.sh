#!/bin/bash
set -euo pipefail

# TaskForceAI CLI Uninstaller

BINARY_NAME="taskforceai"
APP_SERVER_BINARY_NAME="taskforceai-app-server"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"
INSTALL_DIR="${TASKFORCEAI_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/taskforceai"
DEFAULT_DATA_DIR="$HOME/.taskforceai"
RUN_STORE_PATH="${TASKFORCE_APP_SERVER_RUN_STORE:-$DEFAULT_DATA_DIR/app-server.sqlite3}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
  echo -e "${BLUE}==>${NC} $1"
}

success() {
  echo -e "${GREEN}==>${NC} $1"
}

warn() {
  echo -e "${YELLOW}==>${NC} $1"
}

error() {
  echo -e "${RED}Error:${NC} $1" >&2
}

# Find where the binary is installed
find_binary() {
  local locations=(
    "$INSTALL_DIR/$BINARY_NAME"
    "$DEFAULT_INSTALL_DIR/$BINARY_NAME"
    "/usr/local/bin/$BINARY_NAME"
    "/usr/bin/$BINARY_NAME"
  )

  for loc in "${locations[@]}"; do
    if [ -f "$loc" ]; then
      echo "$loc"
      return 0
    fi
  done

  # Try which as fallback
  if command -v "$BINARY_NAME" &>/dev/null; then
    which "$BINARY_NAME"
    return 0
  fi

  return 1
}

find_app_server_binary() {
  local locations=(
    "$INSTALL_DIR/$APP_SERVER_BINARY_NAME"
    "$DEFAULT_INSTALL_DIR/$APP_SERVER_BINARY_NAME"
    "/usr/local/bin/$APP_SERVER_BINARY_NAME"
    "/usr/bin/$APP_SERVER_BINARY_NAME"
  )

  for loc in "${locations[@]}"; do
    if [ -f "$loc" ]; then
      echo "$loc"
      return 0
    fi
  done

  if command -v "$APP_SERVER_BINARY_NAME" &>/dev/null; then
    which "$APP_SERVER_BINARY_NAME"
    return 0
  fi

  return 1
}

main() {
  local binary_path
  local remove_config=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
    --purge)
      remove_config=true
      shift
      ;;
    *)
      error "Unknown option: $1"
      echo "Usage: uninstall.sh [--purge]"
      echo "  --purge  Also remove configuration and data files"
      exit 1
      ;;
    esac
  done

  info "Looking for TaskForceAI CLI installation..."

  if binary_path=$(find_binary); then
    info "Found binary at: $binary_path"
    rm -f "$binary_path"
    success "Removed $binary_path"
  else
    warn "TaskForceAI CLI binary not found"
  fi

  if binary_path=$(find_app_server_binary); then
    info "Found app-server binary at: $binary_path"
    rm -f "$binary_path"
    success "Removed $binary_path"
  fi

  if [ "$remove_config" = true ]; then
    if [ -d "$CONFIG_DIR" ]; then
      info "Removing configuration directory: $CONFIG_DIR"
      rm -rf "$CONFIG_DIR"
      success "Removed $CONFIG_DIR"
    else
      info "No configuration directory found at $CONFIG_DIR"
    fi
    if [ -n "${TASKFORCE_APP_SERVER_RUN_STORE:-}" ]; then
      if [ -f "$RUN_STORE_PATH" ] || [ -f "$RUN_STORE_PATH-wal" ] || [ -f "$RUN_STORE_PATH-shm" ]; then
        info "Removing app-server data: $RUN_STORE_PATH"
        rm -f "$RUN_STORE_PATH" "$RUN_STORE_PATH-wal" "$RUN_STORE_PATH-shm"
        success "Removed app-server data"
      else
        info "No app-server data found at $RUN_STORE_PATH"
      fi
    elif [ -d "$DEFAULT_DATA_DIR" ]; then
      info "Removing data directory: $DEFAULT_DATA_DIR"
      rm -rf "$DEFAULT_DATA_DIR"
      success "Removed $DEFAULT_DATA_DIR"
    else
      info "No data directory found at $DEFAULT_DATA_DIR"
    fi
  else
    if [ -d "$CONFIG_DIR" ]; then
      info "Configuration directory preserved at $CONFIG_DIR"
      echo "    Run with --purge to remove it"
    fi
  fi

  success "TaskForceAI CLI uninstalled"
}

main "$@"
