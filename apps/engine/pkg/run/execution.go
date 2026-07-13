package run

import (
	"context"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/orchestrator"
)

func executeDirectMediaGeneration(ctx context.Context, input mediaGenerationInput) (string, error) {
	if input.Adapter == nil {
		return "", fmt.Errorf("media generation adapter is nil")
	}

	message := buildUserMessage(input.Prompt, Attachments{})
	if input.HasAttachments {
		message = buildUserMessage(input.Prompt, input.Attachments)
	}

	completion, err := input.Adapter.CreateChatCompletion(ctx, agent.ChatCompletionCreateParams{
		Model:    input.ModelID,
		Messages: []agent.ChatCompletionMessage{message},
	})
	if err != nil {
		return "", err
	}
	if completion == nil || len(completion.Choices) == 0 {
		return "", fmt.Errorf("media generation returned no choices")
	}
	result := strings.TrimSpace(completion.Choices[0].Message.Content)
	if result == "" {
		return "", fmt.Errorf("media generation returned an empty result")
	}
	return result, nil
}

func executeTaskOrchestration(
	ctx context.Context,
	input taskExecutionInput,
) (string, *orchestrator.OrchestrationTrace, error) {
	var parts []agent.ContentPart
	if input.HasAttachments {
		parts = attachmentsToContentParts(input.Attachments)
	}
	if !input.TrustLayerEnabled {
		if input.HasAttachments {
			return ExecuteOrchestrateMultimodal(input.Orchestrator, ctx, input.Prompt, parts)
		}
		return ExecuteOrchestrate(input.Orchestrator, ctx, input.Prompt)
	}

	existingTrace := loadExecutionTraceForResume(ctx, input.TraceRepo, input.TaskID, input.TrustUserID)
	if existingTrace != nil {
		return ExecuteResumeOrchestration(input.Orchestrator, ctx, input.Prompt, parts, input.TaskID, input.TrustUserID, existingTrace)
	}
	if input.HasAttachments {
		return ExecuteOrchestrateMultimodalWithTask(input.Orchestrator, ctx, input.Prompt, parts, input.TaskID, input.TrustUserID)
	}
	return ExecuteOrchestrateWithTask(input.Orchestrator, ctx, input.Prompt, input.TaskID, input.TrustUserID)
}

func clientMCPToolDescriptors(tools []ClientMCPTool) []orchestrator.ClientMCPToolDescriptor {
	descriptors := make([]orchestrator.ClientMCPToolDescriptor, len(tools))
	for i, tool := range tools {
		descriptors[i] = orchestrator.ClientMCPToolDescriptor{
			ServerName:  tool.ServerName,
			ToolName:    tool.ToolName,
			Title:       tool.Title,
			Description: tool.Description,
		}
	}
	return descriptors
}
