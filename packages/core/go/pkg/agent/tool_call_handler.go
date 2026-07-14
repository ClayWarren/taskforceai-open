package agent

import (
	"context"
	"fmt"

	"github.com/TaskForceAI/core/pkg/tools"
)

const toolResultPreviewMaxBytes = 500

type ToolCallHandlerDeps struct {
	DiscoveredTools     map[string]tools.ITool
	RegisterToolFailure func(name string) int
	ResetToolFailures   func(name string)
	LogToolEvent        func(event ToolEvent)
}

func executeToolSafely(ctx context.Context, tool tools.ITool, args string) (result tools.ToolResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic detected: %v", r)
		}
	}()
	return tool.Execute(ctx, args)
}

func truncateStringForPreview(value string) string {
	maxBytes := toolResultPreviewMaxBytes
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	end := 0
	for idx := range value {
		if idx > maxBytes {
			break
		}
		end = idx
	}
	return value[:end] + "..."
}
