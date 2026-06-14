# TaskForceAI CLI Installer for Windows PowerShell
# Usage: irm https://taskforceai.chat/install.ps1 | iex
#
# .SYNOPSIS
#   Downloads and installs the TaskForceAI CLI.
# .DESCRIPTION
#   This script detects the architecture, downloads the latest release from GitHub,
#   extracts it, and adds it to the user's PATH.
#
[Diagnostics.CodeAnalysis.SuppressMessageAttribute("PSAvoidUsingWriteHost", "", Justification="This is an interactive installer script where colored output is desired.")]
param()

$ErrorActionPreference = "Stop"

$REPO = "ClayWarren/taskforceai-open"
$BINARY_NAME = "taskforceai.exe"
$APP_SERVER_BINARY_NAME = "taskforceai-app-server.exe"
$INSTALL_DIR = "$env:LOCALAPPDATA\taskforceai\bin"

# Ensure install directory exists
if (-not (Test-Path -Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

Write-Host "==> Detecting system..." -ForegroundColor Cyan

# Detect Architecture
if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") {
    $ARCH = "amd64"
} elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    $ARCH = "arm64"
} else {
    Write-Error "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE"
    exit 1
}

Write-Host "==> Detected: windows/$ARCH" -ForegroundColor Cyan

# Get Latest Version
Write-Host "==> Fetching latest version..." -ForegroundColor Cyan

try {
    if ($env:TASKFORCEAI_VERSION) {
        $VERSION = $env:TASKFORCEAI_VERSION
        Write-Host "==> Using specified version: $VERSION" -ForegroundColor Cyan
    } else {
        $RELEASE_URL = "https://api.github.com/repos/$REPO/releases/latest"
        $RELEASE_DATA = Invoke-RestMethod -Uri $RELEASE_URL
        $VERSION = $RELEASE_DATA.tag_name
        Write-Host "==> Latest version: $VERSION" -ForegroundColor Cyan
    }
} catch {
    Write-Error "Failed to fetch latest version. Check your internet connection."
    exit 1
}

if ($VERSION -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') {
    Write-Error "Invalid version '$VERSION'. Only alphanumeric characters, dots, and dashes are allowed."
    exit 1
}

# Construct Download URL
$ARCHIVE_NAME = "taskforceai-cli-windows-${ARCH}.zip"
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE_NAME"
$CHECKSUMS_URL = "https://github.com/$REPO/releases/download/$VERSION/cli-checksums.txt"
do {
    $TEMP_DIR = Join-Path ([System.IO.Path]::GetTempPath()) ("taskforceai_install_" + [System.IO.Path]::GetRandomFileName())
} while (Test-Path -Path $TEMP_DIR)
$ZIP_PATH = Join-Path $TEMP_DIR $ARCHIVE_NAME
$CHECKSUMS_PATH = Join-Path $TEMP_DIR "cli-checksums.txt"

New-Item -ItemType Directory -Path $TEMP_DIR -ErrorAction Stop | Out-Null

try {
    # Download
    Write-Host "==> Downloading $ARCHIVE_NAME..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $ZIP_PATH
    } catch {
        throw "Failed to download $DOWNLOAD_URL"
    }

    # Download and verify checksum
    Write-Host "==> Verifying checksum..." -ForegroundColor Cyan
    if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
        throw "This installer requires PowerShell 4.0 or newer for checksum verification. Please update PowerShell and try again."
    }

    try {
        Invoke-WebRequest -Uri $CHECKSUMS_URL -OutFile $CHECKSUMS_PATH
    } catch {
        throw "Failed to download checksums from $CHECKSUMS_URL"
    }

    $EXPECTED_CHECKSUM = $null
    foreach ($LINE in Get-Content -Path $CHECKSUMS_PATH) {
        $PARTS = $LINE -split '\s+'
        if ($PARTS.Length -lt 2) {
            continue
        }
        $CHECKSUM_FILE = [System.IO.Path]::GetFileName($PARTS[-1].TrimStart('*'))
        if ($PARTS[0] -match '^[a-fA-F0-9]{64}$' -and $CHECKSUM_FILE -eq $ARCHIVE_NAME) {
            $EXPECTED_CHECKSUM = $PARTS[0].ToLower()
            break
        }
    }

    if (-not $EXPECTED_CHECKSUM) {
        throw "Could not find checksum for $ARCHIVE_NAME"
    }

    $ACTUAL_CHECKSUM = (Get-FileHash -Path $ZIP_PATH -Algorithm SHA256).Hash.ToLower()
    if ($ACTUAL_CHECKSUM -ne $EXPECTED_CHECKSUM) {
        throw "Checksum verification failed for $ARCHIVE_NAME. Expected: $EXPECTED_CHECKSUM Actual: $ACTUAL_CHECKSUM"
    }

    # Extract
    Write-Host "==> Extracting..." -ForegroundColor Cyan
    try {
        Expand-Archive -Path $ZIP_PATH -DestinationPath $TEMP_DIR -Force
    } catch {
        throw "Failed to extract archive"
    }

    # Install
    Write-Host "==> Installing to $INSTALL_DIR..." -ForegroundColor Cyan
    $CLI_SOURCE = Join-Path $TEMP_DIR $BINARY_NAME
    if (-not (Test-Path -Path $CLI_SOURCE)) {
        $CLI_SOURCE = Join-Path $TEMP_DIR "taskforceai-windows-${ARCH}.exe"
    }
    if (-not (Test-Path -Path $CLI_SOURCE)) {
        throw "Could not find CLI binary in extracted files"
    }
    Move-Item -Path $CLI_SOURCE -Destination (Join-Path $INSTALL_DIR $BINARY_NAME) -Force

    $APP_SERVER_SOURCE = Join-Path $TEMP_DIR "taskforceai-app-server-windows-${ARCH}.exe"
    if (-not (Test-Path -Path $APP_SERVER_SOURCE)) {
        throw "Could not find app-server binary in extracted files"
    }
    Move-Item -Path $APP_SERVER_SOURCE -Destination (Join-Path $INSTALL_DIR $APP_SERVER_BINARY_NAME) -Force

    Write-Host "==> TaskForceAI CLI installed successfully!" -ForegroundColor Green
} catch {
    Write-Error $_
    exit 1
} finally {
    Remove-Item -Path $TEMP_DIR -Recurse -Force -ErrorAction SilentlyContinue
}

# Add to PATH
$USER_PATH = [Environment]::GetEnvironmentVariable("Path", "User")
if ($USER_PATH -notlike "*$INSTALL_DIR*") {
    Write-Warning "$INSTALL_DIR is not in your PATH."
    Write-Host "Adding to PATH..."
    [Environment]::SetEnvironmentVariable("Path", "$USER_PATH;$INSTALL_DIR", "User")
    $env:Path += ";$INSTALL_DIR"
    Write-Host "==> Added to PATH. You may need to restart your terminal." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Run 'taskforceai --help' to get started" -ForegroundColor Green
