package agent

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
)

func (s *agentStream) getAssistantMessage(params ChatCompletionCreateParams, fullResponseContent []string) (*ChatCompletionMessage, error) {
	if s.opts.onChunk != nil {
		return s.getAssistantMessageStream(params, fullResponseContent)
	}

	resp, err := s.opts.client.CreateChatCompletion(s.opts.ctx, params)
	if err != nil {
		return nil, fmt.Errorf("LLM call failed: %w", err)
	}
	if s.opts.usageLogger != nil {
		stage := s.opts.agentLabel
		if stage == "" {
			stage = "agent"
		}
		s.opts.usageLogger(UsagePayload{
			Usage: &resp.Usage,
			Model: s.opts.model,
			Stage: stage,
		})
	}
	if len(resp.Choices) == 0 {
		return nil, nil //nolint:nilnil // No choice is a valid end-of-stream signal to the caller.
	}
	return &resp.Choices[0].Message, nil
}

func (s *agentStream) getAssistantMessageStream(params ChatCompletionCreateParams, fullResponseContent []string) (*ChatCompletionMessage, error) {
	var fullContent strings.Builder
	var fullReasoning strings.Builder
	visibleContent := newStreamedVisibleContent(fullResponseContent)
	var fullToolCalls []ToolCall

	err := s.opts.client.CreateChatCompletionStream(s.opts.ctx, params, func(chunk ChatCompletionChunk) {
		if chunk.Usage != nil && s.opts.usageLogger != nil {
			stage := s.opts.agentLabel
			if stage == "" {
				stage = "agent"
			}
			s.opts.usageLogger(UsagePayload{
				Usage: chunk.Usage,
				Model: s.opts.model,
				Stage: stage,
			})
		}

		if len(chunk.Choices) > 0 {
			s.processChunkChoice(&chunk.Choices[0], &fullContent, &fullReasoning, visibleContent, &fullToolCalls)
		}
	})
	if err != nil {
		return nil, fmt.Errorf("streaming failed: %w", err)
	}

	return &ChatCompletionMessage{
		Role:      RoleAssistant,
		Content:   fullContent.String(),
		Reasoning: fullReasoning.String(),
		ToolCalls: fullToolCalls,
	}, nil
}

func newStreamedVisibleContent(fullResponseContent []string) *strings.Builder {
	visible := &strings.Builder{}
	prefix := strings.Join(fullResponseContent, "\n\n")
	if prefix == "" {
		return visible
	}
	visible.Grow(len(prefix) + 2)
	visible.WriteString(prefix)
	visible.WriteString("\n\n")
	return visible
}

func (s *agentStream) processChunkChoice(choice *ChatCompletionChunkChoice, fullContent *strings.Builder, fullReasoning *strings.Builder, visibleContent *strings.Builder, fullToolCalls *[]ToolCall) {
	delta := choice.Delta
	contentDelta := delta.Content
	reasoningDelta := delta.Reasoning

	if contentDelta != "" {
		fullContent.WriteString(contentDelta)
		visibleContent.WriteString(contentDelta)
		s.opts.onChunk(visibleContent.String())
	}
	if reasoningDelta != "" {
		fullReasoning.WriteString(reasoningDelta)
		if s.opts.onReasoning != nil {
			s.opts.onReasoning(fullReasoning.String())
		}
	}
	if len(delta.ToolCalls) > 0 {
		*fullToolCalls = mergeToolCallChunks(*fullToolCalls, delta.ToolCalls)
		s.logReadyToolCalls(*fullToolCalls)
	}
}

func (s *agentStream) logReadyToolCalls(toolCalls []ToolCall) {
	if s.opts.toolLogger == nil {
		return
	}
	for index, toolCall := range toolCalls {
		toolCall = s.repairSearchToolCallArguments(toolCall)
		key := liveToolCallLogKey(index, toolCall)
		if s.liveToolCallLoggedBy[key] {
			continue
		}
		if !isToolCallReadyForLiveLog(toolCall) {
			continue
		}
		s.opts.toolLogger(ToolEvent{
			InvocationID: toolCall.ID,
			ToolName:     toolCall.Function.Name,
			Arguments:    toolCall.Function.Arguments,
			Status:       "running",
			Success:      true,
		})
		s.liveToolCallLoggedBy[key] = true
	}
}

func liveToolCallLogKey(index int, toolCall ToolCall) string {
	if toolCall.ID != "" {
		return toolCall.ID
	}
	return fmt.Sprintf("%d:%s:%s", index, toolCall.Function.Name, toolCall.Function.Arguments)
}

func isToolCallReadyForLiveLog(toolCall ToolCall) bool {
	if toolCall.Function.Name == "" {
		return false
	}
	arguments := strings.TrimSpace(toolCall.Function.Arguments)
	if arguments == "" {
		return false
	}
	return json.Valid([]byte(arguments))
}

func mergeToolCallChunks(existing []ToolCall, chunks []ToolCall) []ToolCall {
	for _, tc := range chunks {
		idx := 0
		if tc.Index != nil {
			idx = *tc.Index
		}
		if idx < 0 {
			platform.GetLogger().Warn("Ignoring tool call chunk with negative index", "index", idx)
			continue
		}
		if idx >= maxStreamedToolCallSlots {
			platform.GetLogger().Warn("Ignoring tool call chunk with out-of-range index", "index", idx, "max", maxStreamedToolCallSlots)
			continue
		}
		// Ensure the buffer is large enough for this index
		for len(existing) <= idx {
			existing = append(existing, ToolCall{})
		}

		// Merge the chunk into the buffered tool call
		target := &existing[idx]
		if tc.ID != "" {
			target.ID = tc.ID
		}
		if tc.Type != "" {
			target.Type = tc.Type
		}
		if tc.Function.Name != "" {
			target.Function.Name = tc.Function.Name
		}
		if tc.Function.Arguments != "" {
			target.Function.Arguments += tc.Function.Arguments
		}
	}
	return existing
}
