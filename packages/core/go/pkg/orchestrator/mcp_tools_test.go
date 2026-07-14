package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestBuildClientMCPToolNameSanitizesFallbacks(t *testing.T) {
	assert.Equal(t, "mcp_server_tool", buildClientMCPToolName(" !!! ", " "))
	assert.Equal(t, "mcp_github_server_list_repos", buildClientMCPToolName(" GitHub Server ", "list/repos"))
}

func TestClientMCPToolRuntimeNameUsesComputerUseOverride(t *testing.T) {
	assert.Equal(
		t,
		"computer_use",
		clientMCPToolRuntimeName(ClientMCPToolDescriptor{
			ServerName: "local-computer-use",
			ToolName:   "computer_use",
		}),
	)
	assert.Equal(
		t,
		"mcp_local_computer_use_screenshot",
		clientMCPToolRuntimeName(ClientMCPToolDescriptor{
			ServerName: "local-computer-use",
			ToolName:   "screenshot",
		}),
	)
}

func TestRegisterClientMCPTools(t *testing.T) {
	registry := tools.NewToolRegistry()
	approvalReg := new(MockApprovalRegistry)
	orchestrator := &TaskOrchestrator{registry: registry, approvalReg: approvalReg}

	orchestrator.RegisterClientMCPTools("task-1", []ClientMCPToolDescriptor{
		{ServerName: "GitHub", ToolName: "list_repos", Description: "List repositories"},
		{ServerName: " ", ToolName: "skip"},
		{ServerName: "GitHub", ToolName: " "},
	})

	all := registry.All()
	assert.Len(t, all, 1)
	assert.Equal(t, "mcp_github_list_repos", all[0].Name())
	assert.Equal(t, "List repositories", all[0].Description())

	(&TaskOrchestrator{}).RegisterClientMCPTools("task-1", []ClientMCPToolDescriptor{{ServerName: "s", ToolName: "t"}})
	orchestrator.RegisterClientMCPTools("", []ClientMCPToolDescriptor{{ServerName: "s", ToolName: "t"}})
	assert.Len(t, registry.All(), 1)
}

func TestClientMCPToolExecuteRequestsApprovalAndReturnsResult(t *testing.T) {
	approvalReg := new(MockApprovalRegistry)
	tool := newClientMCPTool("task-1", approvalReg, ClientMCPToolDescriptor{
		ServerName: "GitHub",
		ToolName:   "list_repos",
	})
	ctx := context.Background()
	var approvalID string
	approvalReg.On("RequestApproval", ctx, mock.MatchedBy(func(req ApprovalRequest) bool {
		approvalID = req.ApprovalID
		return req.TaskID == "task-1" &&
			strings.HasPrefix(req.ApprovalID, "task-1:mcp:github:list_repos:") &&
			req.Permission == "mcp.call" &&
			req.Metadata["source"] == mcpApprovalSource &&
			req.Metadata["action"] == mcpApprovalAction &&
			req.Metadata["serverName"] == "GitHub" &&
			req.Metadata["toolName"] == "list_repos"
	})).Return(nil).Once()
	approvalReg.On("WaitForExecutionDecision", ctx, mock.MatchedBy(func(id string) bool {
		return id == approvalID && strings.HasPrefix(id, "task-1:mcp:github:list_repos:")
	})).Return(map[string]any{"content": "ok"}, nil).Once()
	approvalReg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
		return id == approvalID && strings.HasPrefix(id, "task-1:mcp:github:list_repos:")
	})).Return(nil).Once()

	result, err := tool.Execute(ctx, `{"owner":"taskforce"}`)
	require.NoError(t, err)
	assert.Equal(t, tools.ToolResult{"content": "ok"}, result)
	approvalReg.AssertExpectations(t)
}

func TestClientMCPToolExecuteErrorsAndNilResult(t *testing.T) {
	ctx := context.Background()
	approvalReg := new(MockApprovalRegistry)
	tool := newClientMCPTool("task-1", approvalReg, ClientMCPToolDescriptor{ServerName: "s", ToolName: "t"})

	_, err := tool.Execute(ctx, `{bad json`)
	require.Error(t, err)

	approvalReg.On("RequestApproval", ctx, mock.Anything).Return(errors.New("denied")).Once()
	_, err = tool.Execute(ctx, `{}`)
	require.ErrorContains(t, err, "request MCP execution approval")

	approvalReg.On("RequestApproval", ctx, mock.Anything).Return(nil).Once()
	approvalReg.On("WaitForExecutionDecision", ctx, mock.MatchedBy(func(id string) bool {
		return strings.HasPrefix(id, "task-1:mcp:s:t:")
	})).Return(nil, errors.New("timeout")).Once()
	approvalReg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
		return strings.HasPrefix(id, "task-1:mcp:s:t:")
	})).Return(nil).Once()
	_, err = tool.Execute(ctx, `{}`)
	require.ErrorContains(t, err, "await MCP execution result")

	approvalReg.On("RequestApproval", ctx, mock.Anything).Return(nil).Once()
	approvalReg.On("WaitForExecutionDecision", ctx, mock.MatchedBy(func(id string) bool {
		return strings.HasPrefix(id, "task-1:mcp:s:t:")
	})).Return(nil, nil).Once()
	approvalReg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
		return strings.HasPrefix(id, "task-1:mcp:s:t:")
	})).Return(nil).Once()
	result, err := tool.Execute(ctx, `{}`)
	require.NoError(t, err)
	assert.Equal(t, tools.ToolResult{"content": "MCP tool returned no result."}, result)
}
