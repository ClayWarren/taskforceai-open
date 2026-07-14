package agent

import (
	"encoding/json"
	"strings"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/platform"
)

type assistantToolCallResult struct {
	finished              bool
	generatedFileProduced bool
}

func (s *agentStream) handleAssistantToolCalls(toolCalls []ToolCall, messages *[]ChatCompletionMessage, generatedFileToolUsed bool) assistantToolCallResult {
	var pendingImages []ContentPart
	var generatedFileProduced bool
	needsGeneratedFileCorrection := false
	for i, tc := range toolCalls {
		if tc.Function.Name == "mark_task_complete" {
			if s.opts.requireGeneratedFileTool && !generatedFileToolUsed && !generatedFileProduced {
				*messages = append(*messages, skippedToolResponse(tc, "generated file tool required before marking task complete"))
				needsGeneratedFileCorrection = true
				continue
			}
			if skipped := len(toolCalls) - i - 1; skipped > 0 {
				platform.GetLogger().Debug("Skipping tool calls after task completion", "skipped", skipped)
			}
			s.appendTaskCompleteEvents(tc.Function.Arguments)
			return assistantToolCallResult{finished: true, generatedFileProduced: generatedFileProduced}
		}

		res := s.executeToolCall(s.opts.handlerDeps, tc)
		if res.generatedFile != nil {
			generatedFileProduced = true
		}
		s.events = append(s.events, res.event)
		*messages = append(*messages, res.message)
		if res.imageBase64 != "" {
			pendingImages = append(pendingImages, ContentPart{
				Type: ContentPartImageURL,
				ImageURL: &ImageURLPart{
					URL:    "data:image/png;base64," + res.imageBase64,
					Detail: "low",
				},
			})
		}
	}
	s.appendPendingImages(messages, pendingImages)
	if needsGeneratedFileCorrection {
		*messages = append(*messages, ChatCompletionMessage{
			Role:    RoleUser,
			Content: generatedFileToolRequiredCorrection(),
		})
	}
	return assistantToolCallResult{generatedFileProduced: generatedFileProduced}
}

func (s *agentStream) appendSkippedToolResponses(messages *[]ChatCompletionMessage, toolCalls []ToolCall, reason string) {
	for _, toolCall := range toolCalls {
		*messages = append(*messages, skippedToolResponse(toolCall, reason))
	}
}

func skippedToolResponse(toolCall ToolCall, reason string) ChatCompletionMessage {
	payload, err := marshalSkippedToolResponse(map[string]any{
		"success": false,
		"skipped": true,
		"reason":  reason,
	})
	if err != nil {
		payload = []byte(`{"success":false,"skipped":true}`)
	}
	return ChatCompletionMessage{
		Role:    RoleTool,
		Content: string(payload),
		ToolID:  toolCall.ID,
	}
}

var marshalSkippedToolResponse = json.Marshal

func (s *agentStream) appendTaskCompleteEvents(args string) {
	if completionMessage := completionMessageFromTaskCompleteArgs(args); completionMessage != "" {
		s.events = append(s.events, enginecore.Event{
			Type: enginecore.EventText,
			Text: completionMessage,
		})
	}
	s.events = append(s.events, enginecore.Event{Type: enginecore.EventFinishStep})
}

func (s *agentStream) appendPendingImages(messages *[]ChatCompletionMessage, pendingImages []ContentPart) {
	if len(pendingImages) == 0 {
		return
	}

	parts := make([]ContentPart, 0, 1+len(pendingImages))
	parts = append(parts, ContentPart{Type: ContentPartText, Text: "Here is the screenshot from the tool call above."})
	parts = append(parts, pendingImages...)
	*messages = append(*messages, ChatCompletionMessage{
		Role:         RoleUser,
		ContentParts: parts,
	})
}

func completionMessageFromTaskCompleteArgs(args string) string {
	var input struct {
		TaskSummary       string `json:"task_summary"`
		CompletionMessage string `json:"completion_message"`
	}
	if err := json.Unmarshal([]byte(args), &input); err != nil {
		return ""
	}
	if msg := strings.TrimSpace(input.CompletionMessage); msg != "" {
		return msg
	}
	return strings.TrimSpace(input.TaskSummary)
}
