// Package permissionpolicy owns permission-request normalization for enginecore tools.
package permissionpolicy

import (
	"net/url"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// Ask checks a tool permission using stable pattern and metadata semantics.
func Ask(ctx protocol.ToolContext, permission string, metadata map[string]any) error {
	if ctx.Permission == nil {
		return nil
	}
	return ctx.Permission.Ask(protocol.PermissionRequest{
		Permission: permission,
		Patterns:   Patterns(metadata),
		Always:     []string{"*"},
		Metadata:   metadata,
	})
}

// Patterns derives permission match patterns from normalized tool metadata.
func Patterns(metadata map[string]any) []string {
	if path := metadataString(metadata, "filePath"); path != "" {
		return []string{path}
	}
	if path := metadataString(metadata, "path"); path != "" {
		return []string{path}
	}
	if pattern := metadataString(metadata, "pattern"); pattern != "" {
		return []string{pattern}
	}

	rawURL := metadataString(metadata, "url")
	if rawURL == "" {
		return nil
	}

	patterns := []string{rawURL}
	if parsed, err := url.Parse(rawURL); err == nil {
		if host := parsed.Hostname(); host != "" {
			patterns = append(patterns, host)
		}
	}
	return patterns
}

func metadataString(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return value
}
