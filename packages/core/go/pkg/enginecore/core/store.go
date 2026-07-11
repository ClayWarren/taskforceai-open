package core

import "sync"

// Store keeps session messages in memory for now.
type Store struct {
	mu       sync.Mutex
	sessions map[string][]Message
}

func NewStore() *Store {
	return &Store{
		sessions: map[string][]Message{},
	}
}

// MessageStore allows swapping persistence implementations.
type MessageStore interface {
	Append(sessionID string, messages ...Message)
	Messages(sessionID string) []Message
	Replace(sessionID string, messages []Message)
	Reset(sessionID string)
}

func (s *Store) Append(sessionID string, messages ...Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = append(s.sessions[sessionID], cloneMessages(messages)...)
}

func (s *Store) Messages(sessionID string) []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	src := s.sessions[sessionID]
	out := make([]Message, len(src))
	for i, msg := range src {
		out[i] = cloneMessage(msg)
	}
	return out
}

func (s *Store) Replace(sessionID string, messages []Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = cloneMessages(messages)
}

func (s *Store) Reset(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
}

func cloneMessage(msg Message) Message {
	out := Message{
		Info:  cloneMessageInfo(msg.Info),
		Parts: make([]Part, len(msg.Parts)),
	}
	for i, part := range msg.Parts {
		out.Parts[i] = clonePart(part)
	}
	return out
}

func cloneMessages(messages []Message) []Message {
	out := make([]Message, len(messages))
	for i, msg := range messages {
		out[i] = cloneMessage(msg)
	}
	return out
}

func cloneMessageInfo(info MessageInfo) MessageInfo {
	out := info
	if info.Model != nil {
		model := *info.Model
		out.Model = &model
	}
	if info.Tokens != nil {
		tokens := *info.Tokens
		out.Tokens = &tokens
	}
	if info.Path != nil {
		path := *info.Path
		out.Path = &path
	}
	if info.Error != nil {
		errCopy := *info.Error
		if info.Error.Data != nil {
			errCopy.Data = cloneMap(info.Error.Data)
		}
		out.Error = &errCopy
	}
	return out
}

func clonePart(part Part) Part {
	out := part
	if part.Tokens != nil {
		tokens := *part.Tokens
		out.Tokens = &tokens
	}
	if part.State != nil {
		state := *part.State
		if part.State.Input != nil {
			state.Input = cloneMap(part.State.Input)
		}
		if part.State.Metadata != nil {
			state.Metadata = cloneMap(part.State.Metadata)
		}
		if part.State.Attachments != nil {
			state.Attachments = cloneAttachments(part.State.Attachments)
		}
		if part.State.Title != nil {
			title := *part.State.Title
			state.Title = &title
		}
		out.State = &state
	}
	return out
}

func cloneAttachments(in []map[string]any) []map[string]any {
	out := make([]map[string]any, len(in))
	for i, item := range in {
		out[i] = cloneMap(item)
	}
	return out
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = cloneValue(v)
	}
	return out
}

func cloneValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		return cloneMap(val)
	case []any:
		return cloneSlice(val)
	case []map[string]any:
		return cloneAttachments(val)
	default:
		return val
	}
}

func cloneSlice(in []any) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = cloneValue(v)
	}
	return out
}
