package agent

import (
	"context"
	"errors"
	"fmt"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/platform"
)

const maxStreamedToolCallSlots = 128

type agentStreamOptions struct {
	ctx                      context.Context //nolint:containedctx // A stream owns one request context for its full iteration lifecycle.
	client                   ILLMClient
	model                    string
	temperature              *float64
	reasoningEffort          string
	tools                    []ToolDefinition
	messages                 []ChatCompletionMessage
	maxIterations            int
	agentLabel               string
	usageLogger              UsageLogger
	toolLogger               ToolLogger
	handlerDeps              *ToolCallHandlerDeps
	requireGeneratedFileTool bool
	onChunk                  func(string)
	onReasoning              func(string)

	// Team integration
	TeamInbox TeamInbox
	TeamName  string
	AgentName string
}

type agentStream struct {
	opts                 agentStreamOptions
	events               []enginecore.Event
	err                  error
	nextIndex            int
	built                bool
	liveToolCallLoggedBy map[string]bool
}

var (
	errAgentStreamNilContext      = errors.New("agent stream requires non-nil context")
	errGeneratedFileToolNotCalled = errors.New("generated file tool was required but not called")
)

func newAgentStream(opts agentStreamOptions) *agentStream {
	if opts.maxIterations <= 0 {
		opts.maxIterations = 5
	}
	if opts.ctx == nil {
		return &agentStream{
			opts: opts,
			err:  errAgentStreamNilContext,
		}
	}
	estimatedEvents := opts.maxIterations * 5
	return &agentStream{
		opts:                 opts,
		events:               make([]enginecore.Event, 0, estimatedEvents),
		liveToolCallLoggedBy: make(map[string]bool),
	}
}

func (s *agentStream) Next() (enginecore.Event, bool, error) {
	if s.err != nil {
		return enginecore.Event{}, false, s.err
	}
	if !s.built {
		s.build()
		s.built = true
	}
	if s.err != nil {
		return enginecore.Event{}, false, s.err
	}
	if s.nextIndex >= len(s.events) {
		return enginecore.Event{}, false, nil
	}
	ev := s.events[s.nextIndex]
	s.nextIndex++
	return ev, true, nil
}

func (s *agentStream) build() {
	messages := make([]ChatCompletionMessage, len(s.opts.messages), len(s.opts.messages)+s.opts.maxIterations*2)
	copy(messages, s.opts.messages)
	fullResponseContent := make([]string, 0, s.opts.maxIterations)
	generatedFileToolUsed := false

	for i := 0; i < s.opts.maxIterations; i++ {
		s.appendTeamInboxMessages(&messages)

		params := ChatCompletionCreateParams{
			Messages:        messages,
			Model:           s.opts.model,
			Temperature:     s.opts.temperature,
			ReasoningEffort: s.opts.reasoningEffort,
			Tools:           s.opts.tools,
		}

		assistantMsg, err := s.getAssistantMessage(params, fullResponseContent)
		if err != nil {
			platform.GetLogger().Error("Failed to get assistant message", "iteration", i, "error", err)
			s.err = err
			return
		}
		if assistantMsg == nil {
			break
		}

		messages = append(messages, *assistantMsg)

		content := assistantMsg.Content
		reasoning := assistantMsg.Reasoning

		if s.shouldRequireGeneratedFileTool(content, assistantMsg.ToolCalls, generatedFileToolUsed) {
			s.appendSkippedToolResponses(&messages, assistantMsg.ToolCalls, "generated file tool required before continuing")
			messages = append(messages, ChatCompletionMessage{
				Role:    RoleUser,
				Content: generatedFileToolRequiredCorrection(),
			})
			continue
		}

		s.appendAssistantContent(content, reasoning, &fullResponseContent)

		if len(assistantMsg.ToolCalls) > 0 {
			platform.GetLogger().Info("Agent making tool calls", "count", len(assistantMsg.ToolCalls))
			result := s.handleAssistantToolCalls(assistantMsg.ToolCalls, &messages, generatedFileToolUsed)
			if result.generatedFileProduced {
				generatedFileToolUsed = true
			}
			if result.finished {
				return
			}
			continue
		}

		if content != "" {
			s.events = append(s.events, enginecore.Event{Type: enginecore.EventFinishStep})
			return
		}
		break
	}

	s.finishBuild(generatedFileToolUsed)
}

func (s *agentStream) appendTeamInboxMessages(messages *[]ChatCompletionMessage) {
	if s.opts.TeamInbox == nil || s.opts.TeamName == "" || s.opts.AgentName == "" {
		return
	}
	unread, err := s.opts.TeamInbox.MarkRead(s.opts.TeamName, s.opts.AgentName)
	if err != nil {
		platform.GetLogger().Warn("Team inbox MarkRead failed", "team", s.opts.TeamName, "agent", s.opts.AgentName, "error", err)
	}
	for _, message := range unread {
		*messages = append(*messages, ChatCompletionMessage{Role: "user", Content: fmt.Sprintf("[TEAM MESSAGE from %s]: %s", message.From, message.Text)})
		s.events = append(s.events, enginecore.Event{Type: enginecore.EventText, Text: fmt.Sprintf("\n[Received message from %s: %s]\n", message.From, message.Text)})
	}
}

func (s *agentStream) appendAssistantContent(content, reasoning string, fullResponseContent *[]string) {
	if content == "" && reasoning == "" {
		return
	}
	if content != "" {
		*fullResponseContent = append(*fullResponseContent, content)
	}
	s.events = append(s.events, enginecore.Event{Type: enginecore.EventText, Text: content, Reasoning: reasoning})
}

func (s *agentStream) finishBuild(generatedFileToolUsed bool) {
	if s.opts.requireGeneratedFileTool && !generatedFileToolUsed {
		s.err = errGeneratedFileToolNotCalled
		return
	}
	if len(s.events) == 0 || s.events[len(s.events)-1].Type == enginecore.EventFinishStep {
		return
	}
	s.events = append(s.events, enginecore.Event{Type: enginecore.EventFinishStep})
}
