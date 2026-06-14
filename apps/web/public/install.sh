#!/bin/bash
# This installer relies on bash features and must be invoked with bash.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Error: This installer requires bash. Please run it with bash (for example: curl -fsSL https://taskforceai.chat/install.sh | bash)." >&2
  exit 1
fi

set -euo pipefail

# TaskForceAI CLI Installer
# Usage: curl -fsSL https://taskforceai.chat/install.sh | bash
#    or: irm https://taskforceai.chat/install.ps1 | iex (Windows PowerShell)
#    or: curl -fsSL https://taskforceai.chat/install.cmd -o install.cmd && install.cmd && del install.cmd (Windows CMD)
#    or: curl -fsSL https://raw.githubusercontent.com/ClayWarren/taskforceai-open/main/apps/tui/install.sh | bash

REPO="ClayWarren/taskforceai-open"
BINARY_NAME="taskforceai"
INSTALL_DIR="${TASKFORCEAI_INSTALL_DIR:-$HOME/.local/bin}"

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
  exit 1
}

# Detect OS
detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
  Linux*) echo "linux" ;;
  Darwin*) echo "darwin" ;;
  MINGW* | MSYS* | CYGWIN*) echo "windows" ;;
  *) error "Unsupported operating system: $os" ;;
  esac
}

# Detect architecture
detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
  x86_64 | amd64) echo "amd64" ;;
  arm64 | aarch64) echo "arm64" ;;
  *) error "Unsupported architecture: $arch" ;;
  esac
}

# Get latest release version from GitHub API
get_latest_version() {
  local version
  if command -v curl &>/dev/null; then
    version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  elif command -v wget &>/dev/null; then
    version=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  else
    error "Neither curl nor wget found. Please install one of them."
  fi

  if [ -z "$version" ]; then
    error "Failed to fetch latest version. Check your internet connection or GitHub API rate limits."
  fi

  echo "$version"
}

# Download file
download() {
  local url="$1"
  local output="$2"

  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "$output"
  else
    error "Neither curl nor wget found. Please install one of them."
  fi
}

# Verify checksum
verify_checksum() {
  local file="$1"
  local expected="$2"
  local actual

  if command -v sha256sum &>/dev/null; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum &>/dev/null; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    error "Neither sha256sum nor shasum found. Cannot verify download integrity."
  fi

  if [ "$actual" != "$expected" ]; then
    error "Checksum verification failed!\nExpected: $expected\nActual: $actual"
  fi
}

# Add to PATH instructions
print_path_instructions() {
  local shell_name
  shell_name=$(basename "$SHELL")

  case "$shell_name" in
  bash)
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
    echo "    source ~/.bashrc"
    ;;
  zsh)
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    echo "    source ~/.zshrc"
    ;;
  fish)
    echo "    fish_add_path ~/.local/bin"
    ;;
  *)
    echo "    Add $INSTALL_DIR to your PATH"
    ;;
  esac
}

main() {
  local os arch version archive_name binary_name app_server_binary_name download_url
  # tmp_dir is global so it's accessible to the EXIT trap handler
  tmp_dir=""

  info "Detecting system..."
  os=$(detect_os)
  arch=$(detect_arch)
  info "Detected: $os/$arch"

  # Allow version override via environment variable
  if [ -n "${TASKFORCEAI_VERSION:-}" ]; then
    version="$TASKFORCEAI_VERSION"
    info "Using specified version: $version"
  else
    info "Fetching latest version..."
    version=$(get_latest_version)
    info "Latest version: $version"
  fi

  # Construct download URL
  if [ "$os" = "windows" ]; then
    archive_name="taskforceai-cli-windows-${arch}.zip"
    binary_name="taskforceai-windows-${arch}.exe"
    app_server_binary_name="taskforceai-app-server-windows-${arch}.exe"
  else
    archive_name="taskforceai-cli-${os}-${arch}.tar.gz"
    binary_name="taskforceai-${os}-${arch}"
    app_server_binary_name="taskforceai-app-server-${os}-${arch}"
  fi

  download_url="https://github.com/${REPO}/releases/download/${version}/${archive_name}"
  checksums_url="https://github.com/${REPO}/releases/download/${version}/cli-checksums.txt"

  # Create temp directory
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  info "Downloading ${archive_name}..."
  download "$download_url" "$tmp_dir/$archive_name"

  # Download and verify checksum
  info "Verifying checksum..."
  download "$checksums_url" "$tmp_dir/checksums.txt"
  expected_checksum=$(grep "$archive_name" "$tmp_dir/checksums.txt" | awk '{print $1}')
  if [ -z "$expected_checksum" ]; then
    error "Could not find checksum for $archive_name in checksums file"
  fi

  verify_checksum "$tmp_dir/$archive_name" "$expected_checksum"
  success "Checksum verified"

  # Extract
  info "Extracting..."
  if [ "$os" = "windows" ]; then
    unzip -q "$tmp_dir/$archive_name" -d "$tmp_dir"
  else
    tar -xzf "$tmp_dir/$archive_name" -C "$tmp_dir"
  fi

  # Create install directory if it doesn't exist
  mkdir -p "$INSTALL_DIR"

  # Install binary
  info "Installing to $INSTALL_DIR..."
  if [ "$os" = "windows" ]; then
    if [ ! -f "$tmp_dir/$binary_name" ]; then
      error "Could not find CLI binary $binary_name in $archive_name"
    fi
    mv "$tmp_dir/$binary_name" "$INSTALL_DIR/${BINARY_NAME}.exe"
    if [ -f "$tmp_dir/$app_server_binary_name" ]; then
      mv "$tmp_dir/$app_server_binary_name" "$INSTALL_DIR/taskforceai-app-server.exe"
    else
      warn "Release $version does not include taskforceai-app-server; installed CLI binary only"
    fi
  else
    if [ ! -f "$tmp_dir/$binary_name" ]; then
      error "Could not find CLI binary $binary_name in $archive_name"
    fi
    mv "$tmp_dir/$binary_name" "$INSTALL_DIR/$BINARY_NAME"
    chmod +x "$INSTALL_DIR/$BINARY_NAME"
    if [ -f "$tmp_dir/$app_server_binary_name" ]; then
      mv "$tmp_dir/$app_server_binary_name" "$INSTALL_DIR/taskforceai-app-server"
      chmod +x "$INSTALL_DIR/taskforceai-app-server"
    else
      warn "Release $version does not include taskforceai-app-server; installed CLI binary only"
    fi
  fi

  success "TaskForceAI CLI installed successfully!"
  echo ""

  # Check if install directory is in PATH
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    warn "$INSTALL_DIR is not in your PATH"
    echo ""
    echo "Add it to your PATH by running:"
    print_path_instructions
    echo ""
  fi

  # Verify installation
  if [ "$os" = "windows" ]; then
    if [ -x "$INSTALL_DIR/${BINARY_NAME}.exe" ]; then
      success "Installation verified: $INSTALL_DIR/${BINARY_NAME}.exe"
    fi
  else
    if [ -x "$INSTALL_DIR/$BINARY_NAME" ]; then
      success "Installation verified: $INSTALL_DIR/$BINARY_NAME"
      echo ""
      echo "Run 'taskforceai --help' to get started"
    fi
  fi
}

main "$@"
