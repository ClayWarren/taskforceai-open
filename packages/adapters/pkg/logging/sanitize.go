package logging

import "github.com/TaskForceAI/core/pkg/redaction"

// SanitizeValue redacts sensitive values recursively.
func SanitizeValue(value any) any {
	return redaction.SanitizeValue(value)
}
