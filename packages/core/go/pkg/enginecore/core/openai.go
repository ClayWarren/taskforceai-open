package core

// OpenAIStream is a placeholder adapter for TaskforceAI's OpenAI Go SDK stream.
// Implement Next() in your host layer to feed LLMEvent into the core.
type OpenAIStream struct{}

func (s *OpenAIStream) Next() (LLMEvent, bool, error) {
	return LLMEvent{}, false, nil
}
