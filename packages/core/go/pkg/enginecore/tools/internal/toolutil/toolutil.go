// Package toolutil contains shared mechanics for enginecore tool families.
package toolutil

import (
	"context"
	"strconv"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

// NewResult creates a successful result and preserves the original input map.
func NewResult(args map[string]any) protocol.ToolResult {
	if args == nil {
		args = map[string]any{}
	}
	return protocol.ToolResult{Status: "completed", Input: args}
}

// ErrorResult creates an error result with normalized input.
func ErrorResult(args map[string]any, message string) protocol.ToolResult {
	result := NewResult(args)
	result.Status = "error"
	result.Error = message
	return result
}

// InvalidArgs creates the shared invalid-arguments error shape.
func InvalidArgs(tool string, args map[string]any, details ...string) protocol.ToolResult {
	message := "Error: " + tool + ": invalid arguments"
	if len(details) > 0 {
		message += " (" + strings.Join(details, ", ") + ")"
	}
	return ErrorResult(args, message)
}

// EnsureContext fills the context defaults required by all tool families.
func EnsureContext(ctx protocol.ToolContext) protocol.ToolContext {
	if ctx.Ctx == nil {
		ctx.Ctx = context.Background()
	}
	if strings.TrimSpace(ctx.Cwd) == "" {
		ctx.Cwd = util.Worktree()
	}
	if ctx.ReadFiles == nil {
		ctx.ReadFiles = map[string]bool{}
	}
	return ctx
}

// CheckContext reports cancellation before a tool starts work.
func CheckContext(ctx protocol.ToolContext) error { return ctx.Ctx.Err() }

// GetString returns a string argument or the empty string.
func GetString(args map[string]any, key string) string {
	value, _ := args[key].(string)
	return value
}

// ToInt preserves the numeric coercions accepted by the original tool parser.
func ToInt(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int64:
		return int(number), true
	case float64:
		return int(number), true
	case string:
		parsed, err := strconv.Atoi(number)
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

// MarkError mutates an in-flight result into the shared error shape.
func MarkError(result *protocol.ToolResult, message string) {
	result.Status = "error"
	result.Error = message
}
