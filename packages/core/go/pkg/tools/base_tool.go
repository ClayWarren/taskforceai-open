package tools

import (
	"context"
)

type ToolParameters struct {
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties"`
	Required   []string       `json:"required"`
}

type ToolResult map[string]any

type ITool interface {
	Name() string
	Description() string
	Parameters() ToolParameters
	Execute(ctx context.Context, args string) (ToolResult, error)
	ToGatewaySchema() any
}

type BaseTool struct {
	name        string
	description string
	parameters  ToolParameters
	execute     func(ctx context.Context, args string) (ToolResult, error)
}

func NewBaseTool(name, description string, params ToolParameters, execute func(context.Context, string) (ToolResult, error)) *BaseTool {
	if prompt := LoadToolPrompt(name); prompt != "" {
		description = prompt
	}
	return &BaseTool{
		name:        name,
		description: description,
		parameters:  params,
		execute:     execute,
	}
}

func (b *BaseTool) Name() string {
	return b.name
}

func (b *BaseTool) Description() string {
	return b.description
}

func (b *BaseTool) Parameters() ToolParameters {
	return b.parameters
}

func (b *BaseTool) Execute(ctx context.Context, args string) (ToolResult, error) {
	return b.execute(ctx, args)
}

func (b *BaseTool) ToGatewaySchema() any {
	return map[string]any{
		"type": "function",
		"function": map[string]any{
			"name":        b.name,
			"description": b.description,
			"parameters":  b.parameters,
		},
	}
}
