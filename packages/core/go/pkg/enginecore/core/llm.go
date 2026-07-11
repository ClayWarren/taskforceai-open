package core

import "fmt"

type LLMEventType string

const (
	LLMStart       LLMEventType = "start"
	LLMText        LLMEventType = "text"
	LLMToolCall    LLMEventType = "tool-call"
	LLMToolResult  LLMEventType = "tool-result"
	LLMToolError   LLMEventType = "tool-error"
	LLMFinishStep  LLMEventType = "finish-step"
	LLMStreamError LLMEventType = "error"
)

type LLMEvent struct {
	Type         LLMEventType
	Text         string
	ToolName     string
	ToolArgs     map[string]any
	ToolState    map[string]any
	Usage        *Usage
	FinishReason string
	Metadata     map[string]any
	Err          error
}

// LLMStreamAdapter converts LLM events into normalized core events.
type LLMStreamAdapter struct {
	stream LLMStream
}

type LLMStream interface {
	Next() (LLMEvent, bool, error)
}

func NewLLMStreamAdapter(stream LLMStream) *LLMStreamAdapter {
	return &LLMStreamAdapter{stream: stream}
}

func (a *LLMStreamAdapter) Next() (Event, bool, error) {
	ev, ok, err := a.stream.Next()
	if err != nil || !ok {
		if err != nil {
			return Event{}, ok, fmt.Errorf("llm stream: %w", err)
		}
		return Event{}, ok, err
	}

	switch ev.Type {
	case LLMStart:
		return Event{Type: EventStart}, true, nil
	case LLMText:
		return Event{Type: EventText, Text: ev.Text}, true, nil
	case LLMToolCall:
		return Event{
			Type: EventTool,
			Tool: &ToolCall{Name: ev.ToolName, Args: ev.ToolArgs},
		}, true, nil
	case LLMToolResult:
		return Event{
			Type:      EventTool,
			Tool:      &ToolCall{Name: ev.ToolName, Args: ev.ToolArgs},
			ToolState: ev.ToolState,
		}, true, nil
	case LLMToolError:
		return Event{
			Type: EventTool,
			Tool: &ToolCall{Name: ev.ToolName, Args: ev.ToolArgs},
			ToolState: map[string]any{
				"status": "error",
				"input":  ev.ToolArgs,
				"error":  errorMessage(ev.Err),
			},
		}, true, nil
	case LLMFinishStep:
		if ev.Usage != nil || ev.FinishReason != "" || ev.Metadata != nil {
			return Event{
				Type: EventFinishStep,
				FinishStep: &FinishStepData{
					Usage:        ev.Usage,
					FinishReason: ev.FinishReason,
					Metadata:     ev.Metadata,
				},
			}, true, nil
		}
		return Event{Type: EventFinishStep}, true, nil
	case LLMStreamError:
		return Event{Type: EventError, Err: ev.Err}, true, nil
	default:
		return Event{}, true, nil
	}
}

func errorMessage(err error) string {
	if err == nil {
		return "Error: unknown error"
	}
	return "Error: " + err.Error()
}
