package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/tools"
)

const (
	mcpApprovalSource               = "mcp"
	mcpApprovalAction               = "tool_call"
	localComputerUseMCPServerName   = "local-computer-use"
	localComputerUseMCPToolName     = "computer_use"
	localComputerUseToolDescription = "Interact with this Mac through the TaskForceAI Desktop local Computer Use adapter. Use this for screenshots, clicks, typing, waiting, and other GUI actions on the user's local desktop."
)

type ClientMCPToolDescriptor struct {
	ServerName  string
	ToolName    string
	Title       string
	Description string
}

var nonAlphaNumeric = regexp.MustCompile(`[^a-z0-9]+`)

func (o *TaskOrchestrator) RegisterClientMCPTools(taskID string, descriptors []ClientMCPToolDescriptor) {
	if o == nil || o.registry == nil || o.approvalReg == nil || strings.TrimSpace(taskID) == "" {
		return
	}

	for _, descriptor := range descriptors {
		if strings.TrimSpace(descriptor.ServerName) == "" || strings.TrimSpace(descriptor.ToolName) == "" {
			continue
		}
		o.registry.Register(newClientMCPTool(taskID, o.approvalReg, descriptor))
	}
}

func newClientMCPTool(taskID string, approvalReg IApprovalRegistry, descriptor ClientMCPToolDescriptor) tools.ITool {
	toolName := clientMCPToolRuntimeName(descriptor)
	description := strings.TrimSpace(descriptor.Description)
	if description == "" {
		description = fmt.Sprintf("Call the MCP tool %q on the configured server %q.", descriptor.ToolName, descriptor.ServerName)
	}
	if toolName == localComputerUseMCPToolName {
		description = localComputerUseToolDescription
	}

	return tools.NewBaseTool(
		toolName,
		description,
		tools.ToolParameters{
			Type:       "object",
			Properties: map[string]any{},
			Required:   []string{},
		},
		func(ctx context.Context, args string) (tools.ToolResult, error) {
			arguments := map[string]any{}
			if trimmed := strings.TrimSpace(args); trimmed != "" {
				if err := json.Unmarshal([]byte(trimmed), &arguments); err != nil {
					return nil, fmt.Errorf("invalid arguments for MCP tool %s: %w", descriptor.ToolName, err)
				}
			}

			approvalID := nextMCPApprovalID(taskID, descriptor)
			req := ApprovalRequest{
				ApprovalID: approvalID,
				TaskID:     taskID,
				AgentName:  "assistant",
				Permission: "mcp.call",
				Patterns:   []string{descriptor.ServerName, descriptor.ToolName},
				Metadata: map[string]any{
					"source":     mcpApprovalSource,
					"action":     mcpApprovalAction,
					"serverName": descriptor.ServerName,
					"toolName":   descriptor.ToolName,
					"arguments":  arguments,
				},
			}
			if err := approvalReg.RequestApproval(ctx, req); err != nil {
				return nil, fmt.Errorf("request MCP execution approval: %w", err)
			}
			defer func() { _ = approvalReg.ClearApproval(ctx, approvalID) }()

			result, err := approvalReg.WaitForExecutionDecision(ctx, approvalID)
			if err != nil {
				return nil, fmt.Errorf("await MCP execution result: %w", err)
			}
			if result == nil {
				return tools.ToolResult{"content": "MCP tool returned no result."}, nil
			}
			return tools.ToolResult(result), nil
		},
	)
}

func nextMCPApprovalID(taskID string, descriptor ClientMCPToolDescriptor) string {
	server := sanitizeClientMCPName(descriptor.ServerName)
	if server == "" {
		server = "server"
	}
	tool := sanitizeClientMCPName(descriptor.ToolName)
	if tool == "" {
		tool = "tool"
	}
	return fmt.Sprintf("%s:mcp:%s:%s:%d", taskID, server, tool, time.Now().UnixNano())
}

func clientMCPToolRuntimeName(descriptor ClientMCPToolDescriptor) string {
	if strings.EqualFold(strings.TrimSpace(descriptor.ServerName), localComputerUseMCPServerName) &&
		strings.EqualFold(strings.TrimSpace(descriptor.ToolName), localComputerUseMCPToolName) {
		return localComputerUseMCPToolName
	}
	return buildClientMCPToolName(descriptor.ServerName, descriptor.ToolName)
}

func buildClientMCPToolName(serverName string, toolName string) string {
	serverSlug := sanitizeClientMCPName(serverName)
	toolSlug := sanitizeClientMCPName(toolName)
	if serverSlug == "" {
		serverSlug = "server"
	}
	if toolSlug == "" {
		toolSlug = "tool"
	}
	return "mcp_" + serverSlug + "_" + toolSlug
}

func sanitizeClientMCPName(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = nonAlphaNumeric.ReplaceAllString(normalized, "_")
	return strings.Trim(normalized, "_")
}
