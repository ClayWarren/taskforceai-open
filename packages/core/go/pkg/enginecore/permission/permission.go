package permission

import (
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type PermissionAction string

const (
	PermissionAllow PermissionAction = "allow"
	PermissionDeny  PermissionAction = "deny"
	PermissionAsk   PermissionAction = "ask"
)

type PermissionRule struct {
	Permission string
	Pattern    string
	Action     PermissionAction
}

type PermissionRuleset []PermissionRule

var defaultSensitiveFileRules = PermissionRuleset{
	{Permission: "read", Pattern: "*.env", Action: PermissionAsk},
	{Permission: "read", Pattern: "*.env.*", Action: PermissionAsk},
	{Permission: "read", Pattern: "*.env.example", Action: PermissionAllow},
}

// DefaultRules returns defense-in-depth rules applied to every agent unless a
// more specific user configuration overrides them.
func DefaultRules() PermissionRuleset {
	return slices.Clone(defaultSensitiveFileRules)
}

// RuleBasedPermission evaluates a ruleset and returns allow/deny without prompting.
// DefaultAction is used when no rule matches; it should be PermissionAllow for headless runs.
type RuleBasedPermission struct {
	Rules         PermissionRuleset
	DefaultAction PermissionAction
}

func CheckerFromConfig(config map[string]any) *RuleBasedPermission {
	if config == nil {
		return nil
	}
	defaultAction := PermissionAllow
	if rawDefault, ok := config["default"].(string); ok {
		if parsed := parseAction(rawDefault); parsed != "" {
			defaultAction = parsed
		}
	}
	rules := DefaultRules()
	for perm, raw := range config {
		if perm == "default" {
			continue
		}
		switch val := raw.(type) {
		case string:
			if action := parseAction(val); action != "" {
				rules = append(rules, PermissionRule{Permission: perm, Pattern: "*", Action: action})
			}
		case map[string]any:
			for pattern, rawAction := range val {
				if actionStr, ok := rawAction.(string); ok {
					if action := parseAction(actionStr); action != "" {
						rules = append(rules, PermissionRule{Permission: perm, Pattern: pattern, Action: action})
					}
				}
			}
		case map[string]string:
			for pattern, actionStr := range val {
				if action := parseAction(actionStr); action != "" {
					rules = append(rules, PermissionRule{Permission: perm, Pattern: pattern, Action: action})
				}
			}
		}
	}
	return &RuleBasedPermission{Rules: rules, DefaultAction: defaultAction}
}

func (r *RuleBasedPermission) Ask(req protocol.PermissionRequest) error {
	if r == nil {
		return nil
	}
	action := r.evaluate(req.Permission, req.Patterns)
	if action == PermissionDeny {
		return ErrPermissionDenied
	}
	if action == PermissionAsk {
		return ErrPermissionAsk
	}
	return nil
}

func (r *RuleBasedPermission) evaluate(permission string, patterns []string) PermissionAction {
	action := r.DefaultAction
	for _, pattern := range patterns {
		if act := matchRules(permission, pattern, r.Rules); act != "" {
			action = act
		}
	}
	return action
}

func matchRules(permission, pattern string, rules PermissionRuleset) PermissionAction {
	for _, r := range slices.Backward(rules) {
		if matchWildcard(r.Permission, permission) && matchWildcard(r.Pattern, pattern) {
			return r.Action
		}
	}
	return ""
}

func matchWildcard(pattern, value string) bool {
	if pattern == "*" {
		return true
	}
	re, ok := wildcardCache.Load(pattern)
	if !ok {
		escaped := regexp.QuoteMeta(pattern)
		escaped = strings.ReplaceAll(escaped, `\*`, ".*")
		escaped = strings.ReplaceAll(escaped, `\?`, ".")
		if before, ok0 := strings.CutSuffix(escaped, " .*"); ok0 {
			escaped = before + "( .*)?"
		}
		compiled, err := compileWildcardPattern("^" + escaped + "$")
		if err != nil {
			return false
		}
		re = compiled
		wildcardCache.Store(pattern, compiled)
	}
	compiled, ok := re.(*regexp.Regexp)
	if !ok {
		return false
	}
	return compiled.MatchString(value)
}

func parseAction(value string) PermissionAction {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(PermissionAllow):
		return PermissionAllow
	case string(PermissionDeny):
		return PermissionDeny
	case string(PermissionAsk):
		return PermissionAsk
	default:
		return ""
	}
}

var ErrPermissionDenied = &PermissionError{Message: "permission denied"}
var ErrPermissionAsk = &PermissionError{Message: "ask"}

type PermissionError struct {
	Message string
}

func (e *PermissionError) Error() string {
	return e.Message
}

var wildcardCache sync.Map

var compileWildcardPattern = regexp.Compile
