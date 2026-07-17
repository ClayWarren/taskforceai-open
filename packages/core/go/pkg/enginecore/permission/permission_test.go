package permission

import (
	"errors"
	"regexp"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

func TestPermissionRules(t *testing.T) {
	perm := &RuleBasedPermission{
		Rules: PermissionRuleset{
			{Permission: "read", Pattern: "*", Action: PermissionAllow},
			{Permission: "write", Pattern: "*", Action: PermissionDeny},
		},
		DefaultAction: PermissionAllow,
	}
	if err := perm.Ask(protocolPermissionReq("read", "file.txt")); err != nil {
		t.Fatalf("read should be allowed: %v", err)
	}
	if err := perm.Ask(protocolPermissionReq("write", "file.txt")); err == nil {
		t.Fatalf("write should be denied")
	}
}

func TestMatchWildcardOptionalTail(t *testing.T) {
	if !matchWildcard("ls *", "ls") {
		t.Fatalf("expected optional tail match")
	}
	if !matchWildcard("ls *", "ls -la") {
		t.Fatalf("expected wildcard tail match")
	}
	if matchWildcard("ls *", "lss") {
		t.Fatalf("unexpected match")
	}
	if !matchWildcard("*", "anything") {
		t.Fatalf("expected * to match anything")
	}
}

func TestMatchWildcardEdgeBranches(t *testing.T) {
	origCompile := compileWildcardPattern
	compileWildcardPattern = func(string) (*regexp.Regexp, error) {
		return nil, errors.New("compile failed")
	}
	t.Cleanup(func() { compileWildcardPattern = origCompile })

	if matchWildcard("compile-fails-*", "compile-fails-value") {
		t.Fatal("expected compile failure to return false")
	}

	wildcardCache.Store("bad-cache-entry", "not a regexp")
	t.Cleanup(func() { wildcardCache.Delete("bad-cache-entry") })
	if matchWildcard("bad-cache-entry", "bad-cache-entry") {
		t.Fatal("expected invalid cache entry to return false")
	}

	if action := parseAction("invalid"); action != "" {
		t.Fatalf("expected empty action for invalid input, got %q", action)
	}
}

func protocolPermissionReq(permission, pattern string) protocol.PermissionRequest {
	return protocol.PermissionRequest{
		Permission: permission,
		Patterns:   []string{pattern},
		Always:     []string{"*"},
		Metadata:   map[string]any{},
	}
}

func TestCheckerFromConfig(t *testing.T) {
	config := map[string]any{
		"default": "ask",
		"read":    "allow",
		"write": map[string]any{
			"file.txt": "deny",
		},
		"exec": map[string]string{
			"script.sh": "allow",
		},
	}

	checker := CheckerFromConfig(config)
	if checker == nil {
		t.Fatal("checker should not be nil")
	}
	if checker.DefaultAction != PermissionAsk {
		t.Fatalf("expected default action ask, got %s", checker.DefaultAction)
	}

	err := checker.Ask(protocolPermissionReq("read", "anything"))
	if err != nil {
		t.Fatalf("read should be allowed, got error: %v", err)
	}

	err = checker.Ask(protocolPermissionReq("write", "file.txt"))
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	err = checker.Ask(protocolPermissionReq("exec", "script.sh"))
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}

	// Default action
	err = checker.Ask(protocolPermissionReq("unknown", "anything"))
	if !errors.Is(err, ErrPermissionAsk) {
		t.Fatalf("expected ErrPermissionAsk, got %v", err)
	}
}

func TestCheckerFromConfigNilAndEmpty(t *testing.T) {
	checker := CheckerFromConfig(nil)
	if checker != nil {
		t.Fatal("expected nil checker")
	}

	var r *RuleBasedPermission
	err := r.Ask(protocolPermissionReq("read", "any"))
	if err != nil {
		t.Fatalf("expected nil error on nil rulebasedpermission, got %v", err)
	}
}

func TestDefaultSensitiveFileRules(t *testing.T) {
	checker := CheckerFromConfig(map[string]any{})
	if checker == nil {
		t.Fatal("checker should not be nil")
	}
	for _, path := range []string{".env", "services/api.env", ".env.local", "services/.env.production"} {
		if err := checker.Ask(protocolPermissionReq("read", path)); !errors.Is(err, ErrPermissionAsk) {
			t.Fatalf("expected %s to require approval, got %v", path, err)
		}
	}
	if err := checker.Ask(protocolPermissionReq("read", ".env.example")); err != nil {
		t.Fatalf("example env file should remain readable, got %v", err)
	}
	if err := checker.Ask(protocolPermissionReq("read", "README.md")); err != nil {
		t.Fatalf("ordinary files should remain readable, got %v", err)
	}
}

func TestConfiguredSensitiveFileRuleOverridesDefault(t *testing.T) {
	checker := CheckerFromConfig(map[string]any{
		"read": map[string]any{"*.env": "allow"},
	})
	if err := checker.Ask(protocolPermissionReq("read", ".env")); err != nil {
		t.Fatalf("explicit user rule should override the default, got %v", err)
	}
}

func TestErrors(t *testing.T) {
	if ErrPermissionDenied.Error() != "permission denied" {
		t.Fatal("unexpected Error string for ErrPermissionDenied")
	}
	if ErrPermissionAsk.Error() != "ask" {
		t.Fatal("unexpected Error string for ErrPermissionAsk")
	}
}
