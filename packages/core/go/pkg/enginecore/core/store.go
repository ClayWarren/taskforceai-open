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
	return cloneMessages(s.sessions[sessionID])
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
	out.Model = clonePointer(info.Model)
	out.Tokens = clonePointer(info.Tokens)
	out.Path = clonePointer(info.Path)
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
	out.Tokens = clonePointer(part.Tokens)
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
		state.Title = clonePointer(part.State.Title)
		out.State = &state
	}
	return out
}

func clonePointer[T any](in *T) *T {
	if in == nil {
		return nil
	}
	out := *in
	return &out
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
