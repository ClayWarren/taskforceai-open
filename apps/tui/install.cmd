@echo off
setlocal EnableDelayedExpansion

:: TaskForceAI CLI Installer for Windows CMD
:: Usage: curl -fsSL https://taskforceai.chat/install.cmd -o install.cmd && install.cmd && del install.cmd

set "REPO=ClayWarren/taskforceai-open"
set "BINARY_NAME=taskforceai.exe"
set "APP_SERVER_BINARY_NAME=taskforceai-app-server.exe"
set "INSTALL_DIR=%LOCALAPPDATA%\taskforceai\bin"

echo ==^> Detecting system...

:: Detect Architecture
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set "ARCH=amd64"
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "ARCH=arm64"
) else (
    echo Error: Unsupported architecture: %PROCESSOR_ARCHITECTURE%
    exit /b 1
)

echo ==^> Detected: windows/%ARCH%

:: Get Latest Version
echo ==^> Fetching latest version...

if defined TASKFORCEAI_VERSION (
    set "VERSION=%TASKFORCEAI_VERSION%"
    echo ==^> Using specified version: !VERSION!
) else (
    for /f "tokens=*" %%i in ('curl -fsSL https://api.github.com/repos/%REPO%/releases/latest ^| findstr "tag_name"') do (
        set "TAG_LINE=%%i"
    )
    if "!TAG_LINE!"=="" (
        echo Error: Failed to fetch latest version.
        exit /b 1
    )
    :: Extract version from JSON "tag_name": "v0.10.1",
    set "VERSION=!TAG_LINE:*:=!"
    set "VERSION=!VERSION: =!"
    set "VERSION=!VERSION:"=!"
    set "VERSION=!VERSION:,=!"
    echo ==^> Latest version: !VERSION!
)

:: Construct URLs
set "ARCHIVE_NAME=taskforceai-cli-windows-%ARCH%.zip"
set "DOWNLOAD_URL=https://github.com/%REPO%/releases/download/!VERSION!/%ARCHIVE_NAME%"
set "CHECKSUMS_URL=https://github.com/%REPO%/releases/download/!VERSION!/cli-checksums.txt"
for /f "usebackq delims=" %%D in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = Join-Path ([System.IO.Path]::GetTempPath()) ('taskforceai_install_' + [System.IO.Path]::GetRandomFileName()); [System.IO.Directory]::CreateDirectory($path) ^| Out-Null; $path"`) do (
    set "TEMP_DIR=%%D"
)
if "!TEMP_DIR!"=="" (
    echo Error: Failed to create temporary install directory
    exit /b 1
)
set "ZIP_PATH=%TEMP_DIR%\%ARCHIVE_NAME%"
set "CHECKSUMS_PATH=%TEMP_DIR%\cli-checksums.txt"

echo ==^> Downloading %ARCHIVE_NAME%...
curl -fsSL "%DOWNLOAD_URL%" -o "%ZIP_PATH%"
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to download %DOWNLOAD_URL%
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

echo ==^> Verifying checksum...
curl -fsSL "%CHECKSUMS_URL%" -o "%CHECKSUMS_PATH%"
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to download checksum file %CHECKSUMS_URL%
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$archive=$env:ARCHIVE_NAME; $path=$env:CHECKSUMS_PATH; Get-Content -LiteralPath $path | ForEach-Object { if ($_ -match '^([A-Fa-f0-9]{64})\s+\*?(?:\.\\|\./)?(.+)$' -and $Matches[2] -eq $archive) { $Matches[1]; exit 0 } }"`) do (
    set "EXPECTED_CHECKSUM=%%A"
)
if "!EXPECTED_CHECKSUM!"=="" (
    echo Error: Could not find checksum for %ARCHIVE_NAME%
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

for /f "skip=1 tokens=*" %%A in ('certutil -hashfile "%ZIP_PATH%" SHA256') do (
    if not defined ACTUAL_CHECKSUM set "ACTUAL_CHECKSUM=%%A"
)
if "!ACTUAL_CHECKSUM!"=="" (
    echo Error: Failed to compute SHA256 checksum
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

if /I not "!ACTUAL_CHECKSUM!"=="!EXPECTED_CHECKSUM!" (
    echo Error: Checksum verification failed
    echo Expected: !EXPECTED_CHECKSUM!
    echo Actual:   !ACTUAL_CHECKSUM!
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

echo ==^> Checksum verified.

echo ==^> Extracting...
powershell -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%TEMP_DIR%' -Force"
if %ERRORLEVEL% neq 0 (
    echo Error: Failed to extract archive
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

echo ==^> Installing to %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

if exist "%TEMP_DIR%\%BINARY_NAME%" (
    move /y "%TEMP_DIR%\%BINARY_NAME%" "%INSTALL_DIR%\" >nul
) else if exist "%TEMP_DIR%\taskforceai-windows-%ARCH%.exe" (
    move /y "%TEMP_DIR%\taskforceai-windows-%ARCH%.exe" "%INSTALL_DIR%\%BINARY_NAME%" >nul
) else (
    echo Error: Could not find binary in extracted files
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

if exist "%TEMP_DIR%\taskforceai-app-server-windows-%ARCH%.exe" (
    move /y "%TEMP_DIR%\taskforceai-app-server-windows-%ARCH%.exe" "%INSTALL_DIR%\%APP_SERVER_BINARY_NAME%" >nul
) else (
    echo Error: Could not find app-server binary in extracted files
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

:: Cleanup
rmdir /s /q "%TEMP_DIR%"

echo ==^> TaskForceAI CLI installed successfully!

:: Add the install directory to the user PATH without flattening environment
:: variables or truncating long values (both can happen with setx).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$installDir = $env:INSTALL_DIR; $userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); $entries = @($userPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ }); if ($entries -notcontains $installDir) { $nextPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $installDir } else { $userPath.TrimEnd(';') + ';' + $installDir }; [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User'); exit 10 }; exit 0"
set "PATH_UPDATE_EXIT=%ERRORLEVEL%"
if "!PATH_UPDATE_EXIT!"=="10" (
    echo ==^> Added %INSTALL_DIR% to PATH. You may need to restart your terminal.
) else if not "!PATH_UPDATE_EXIT!"=="0" (
    echo Warning: Failed to add %INSTALL_DIR% to PATH.
    echo Add that directory to your user PATH manually.
)

echo.
echo Run 'taskforceai --help' to get started
