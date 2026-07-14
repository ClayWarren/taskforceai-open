package core

// OpenAIEventMapper maps external OpenAI stream events to LLMEvent.
// It is intentionally generic so TaskforceAI can adapt without importing SDK types here.
type OpenAIEventMapper struct{}

func (OpenAIEventMapper) TextDelta(text string) LLMEvent {
	return LLMEvent{Type: LLMText, Text: text}
}

func (OpenAIEventMapper) ToolCall(name string, args map[string]any) LLMEvent {
	return LLMEvent{Type: LLMToolCall, ToolName: name, ToolArgs: args}
}

func (OpenAIEventMapper) ToolError(name string, args map[string]any, err error) LLMEvent {
	return LLMEvent{Type: LLMToolError, ToolName: name, ToolArgs: args, Err: err}
}

func (OpenAIEventMapper) Finish(usage *Usage, finishReason string, metadata map[string]any) LLMEvent {
	return LLMEvent{Type: LLMFinishStep, Usage: usage, FinishReason: finishReason, Metadata: metadata}
}
