#!/bin/bash
#
# TaskForceAI Local Security Check Suite
# Runs static analysis, dependency audits, and secret detection.
#
# This script is intended for local development to catch issues before CI.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     TaskForceAI Local Security Suite                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

EXIT_CODE=0

# Helpers to run security tools without silently skipping local checks.
run_gitleaks() {
  if command -v gitleaks &>/dev/null; then
    gitleaks "$@"
  else
    go run github.com/zricethezav/gitleaks/v8@latest "$@"
  fi
}

run_govulncheck() {
  if command -v govulncheck &>/dev/null; then
    govulncheck "$@"
  else
    go run golang.org/x/vuln/cmd/govulncheck@latest "$@"
  fi
}

run_gosec() {
  if command -v gosec &>/dev/null; then
    gosec "$@"
  else
    go run github.com/securego/gosec/v2/cmd/gosec@latest "$@"
  fi
}

ensure_cargo_audit() {
  if command -v cargo-audit &>/dev/null; then
    return 0
  fi

  echo "   cargo-audit is not installed; installing with cargo..."
  cargo install cargo-audit --locked
}

run_bandit() {
  if command -v bandit &>/dev/null; then
    bandit "$@"
  else
    uvx --python 3.12 bandit "$@"
  fi
}

run_pip_audit() {
  if command -v pip-audit &>/dev/null; then
    pip-audit "$@"
  else
    uvx --python 3.12 pip-audit "$@"
  fi
}

allow_known_js_audit_findings() {
  local audit_json_file=$1
  bun -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const jsonStart = raw.indexOf("{");
if (jsonStart === -1) process.exit(1);

const audit = JSON.parse(raw.slice(jsonStart));
const allowed = new Map([
  [
    "vite",
    new Set([
      "https://github.com/advisories/GHSA-4w7w-66w2-5vf9",
      "https://github.com/advisories/GHSA-p9ff-h696-f583",
    ]),
  ],
]);

for (const [name, advisories] of Object.entries(audit)) {
  const allowedUrls = allowed.get(name);
  if (!allowedUrls) process.exit(1);
  for (const advisory of advisories) {
    if (!allowedUrls.has(advisory.url)) process.exit(1);
  }
}
' "$audit_json_file"
}

# 1. Secret Detection (Gitleaks)
echo -e "${BLUE}1/5 Secret Scanning (Gitleaks)...${NC}"
if run_gitleaks detect --source . -v --redact; then
  echo -e "${GREEN}✅ No secrets detected.${NC}"
else
  echo -e "${RED}❌ Secrets detected! Review the log above.${NC}"
  EXIT_CODE=1
fi
echo ""

# 2. JS/TS Dependency Audit (Bun)
echo -e "${BLUE}2/5 JS/TS Dependency Audit (Bun)...${NC}"
# Capture output to check for specific ignorable vulnerabilities
if bun audit >/tmp/bun_audit_output.txt 2>&1; then
  cat /tmp/bun_audit_output.txt
  echo -e "${GREEN}✅ No JS/TS vulnerabilities found.${NC}"
else
  cat /tmp/bun_audit_output.txt
  bun audit --json >/tmp/bun_audit_output.json 2>&1 || true

  # These Vite advisories affect dev-server file exposure and remain only in
  # upstream vinxi/vitepress toolchains. Runtime app Vite is resolved to 8.x.
  if allow_known_js_audit_findings /tmp/bun_audit_output.json; then
    echo -e "${YELLOW}⚠ Ignoring known transitive Vite dev-server advisories in vinxi/vitepress.${NC}"
  else
    EXIT_CODE=1
    echo -e "${RED}❌ JS/TS vulnerabilities found. Run 'bun update' or check details.${NC}"
  fi
fi
rm -f /tmp/bun_audit_output.txt /tmp/bun_audit_output.json
echo ""

# 3. Go Security (govulncheck & gosec)
echo -e "${BLUE}3/5 Go Security Analysis...${NC}"
GO_VULN_FAIL=0
# Find all go.mod files and run govulncheck in those directories
found_modules=0
while IFS= read -r mod_file; do
  mod_dir=$(dirname "$mod_file")
  echo "   Scanning Go module: $mod_dir"
  found_modules=1
  govuln_output=$(mktemp)
  if (cd "$mod_dir" && run_govulncheck ./...) >"$govuln_output" 2>&1; then
    cat "$govuln_output"
  else
    cat "$govuln_output"
    if grep -q "panic: ForEachElement called on type containing \\*types.TypeParam" "$govuln_output"; then
      echo -e "${YELLOW}⚠ govulncheck symbol scan panicked in $mod_dir; retrying package-level scan.${NC}"
      if ! (cd "$mod_dir" && run_govulncheck -scan=package ./...); then
        echo -e "${RED}❌ Vulnerabilities found in $mod_dir${NC}"
        GO_VULN_FAIL=1
      fi
    else
      echo -e "${RED}❌ Vulnerabilities found in $mod_dir${NC}"
      GO_VULN_FAIL=1
    fi
  fi
  rm -f "$govuln_output"
done < <(find . -name "go.mod" -not -path "*/node_modules/*" -not -path "*/.venv/*")

if [ $found_modules -eq 0 ]; then
  echo "   No Go modules found."
elif [ $GO_VULN_FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ No Go vulnerabilities found.${NC}"
fi

# gosec can handle recursive scans, but let's exclude tests and vendor
if run_gosec -exclude-dir=tests -exclude-dir=vendor -exclude-dir=.venv -exclude-generated -quiet ./...; then
  echo -e "${GREEN}✅ Go static analysis passed.${NC}"
else
  GO_VULN_FAIL=1
fi

if [ $GO_VULN_FAIL -eq 1 ]; then EXIT_CODE=1; fi
echo ""

# 4. Rust Security (Cargo Audit)
echo -e "${BLUE}4/5 Rust/Tauri Security Audit...${NC}"
if [ -d "apps/desktop" ]; then
  cd apps/desktop
  if ensure_cargo_audit; then
    # Update advisory db first
    echo "   Updating Rust advisory database..."
    if cargo audit; then
      echo -e "${GREEN}✅ No Rust vulnerabilities found.${NC}"
    else
      EXIT_CODE=1
    fi
  fi
  cd ../..
else
  echo -e "${YELLOW}Skipping Rust: apps/desktop not found.${NC}"
fi
echo ""

# 5. Python Security (Bandit & pip-audit)
echo -e "${BLUE}5/5 Python Security Analysis...${NC}"
PY_FAIL=0
# Exclude .venv, tests, and node_modules explicitly. Discover project roots so
# the same suite works in both the public repository and the private monorepo.
TARGETS=()
while IFS= read -r project_file; do
  TARGETS+=("$(dirname "$project_file")")
done < <(find apps packages -name "pyproject.toml" -not -path "*/.venv/*" -not -path "*/node_modules/*")

if [ ${#TARGETS[@]} -eq 0 ]; then TARGETS=("."); fi

echo "   Scanning: ${TARGETS[*]}"
if run_bandit -r "${TARGETS[@]}" -ll -x .venv,node_modules,tests,*/tests/*,__pycache__; then
  echo -e "${GREEN}✅ Python static analysis passed.${NC}"
else
  PY_FAIL=1
fi

audited_python=0
tmp_requirements_dir=$(mktemp -d)
trap 'rm -rf "$tmp_requirements_dir"' EXIT

pip_audit_args=(--strict --no-deps --disable-pip)
for vulnerability in ${PIP_AUDIT_IGNORE_VULNS:-}; do
  pip_audit_args+=(--ignore-vuln "$vulnerability")
done

while IFS= read -r project_file; do
  project_dir=$(dirname "$project_file")
  requirements_file="$tmp_requirements_dir/$(echo "$project_dir" | tr '/.' '__').txt"
  export_args=(--project "$project_dir" --format requirements.txt --no-hashes --no-emit-project --output-file "$requirements_file")
  if [ -f "$project_dir/uv.lock" ]; then
    export_args+=(--frozen)
  fi

  echo "   Auditing Python project: $project_dir"
  if uv export "${export_args[@]}" && run_pip_audit "${pip_audit_args[@]}" -r "$requirements_file"; then
    audited_python=1
    echo -e "${GREEN}✅ Python dependencies ($project_dir) passed.${NC}"
  else
    audited_python=1
    PY_FAIL=1
  fi
done < <(find apps packages -name "pyproject.toml" -not -path "*/.venv/*" -not -path "*/node_modules/*")

if [ "$audited_python" -eq 0 ]; then
  echo "   No Python dependency manifests found."
fi

if [ $PY_FAIL -eq 1 ]; then EXIT_CODE=1; fi
echo ""

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════════╗${NC}"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}  ✅ LOCAL SECURITY CHECK PASSED                         ${NC}"
else
  echo -e "${RED}  ❌ LOCAL SECURITY CHECK FAILED                         ${NC}"
fi
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"

exit $EXIT_CODE
