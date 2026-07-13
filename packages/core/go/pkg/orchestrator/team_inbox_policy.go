package orchestrator

import (
	"fmt"
	"strings"
)

// ValidateInboxName enforces the core naming invariant for team inbox keys.
func ValidateInboxName(name, kind string) error {
	trimmed := strings.TrimSpace(name)
	switch {
	case trimmed == "", trimmed == ".", trimmed == "..":
		return fmt.Errorf("invalid %s name", kind)
	case strings.ContainsAny(trimmed, `/\`):
		return fmt.Errorf("invalid %s name", kind)
	default:
		return nil
	}
}
