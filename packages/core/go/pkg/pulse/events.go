package pulse

import (
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maxEventsPerSession = 20

type sessionQueue struct {
	events         []SystemEvent
	lastText       string
	lastContextKey string
	lastActivity   time.Time
}

// EventStore manages ephemeral, session-scoped system events.
type EventStore struct {
	mu     sync.RWMutex
	queues map[string]*sessionQueue
}

// NewEventStore creates a new in-memory event store.
func NewEventStore() *EventStore {
	return &EventStore{
		queues: make(map[string]*sessionQueue),
	}
}

// Enqueue adds a new system event to the specified session.
// It skips consecutive duplicates and maintains a maximum queue size.
func (s *EventStore) Enqueue(sessionKey, text, contextKey string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := strings.TrimSpace(sessionKey)
	if key == "" {
		return
	}

	cleaned := strings.TrimSpace(text)
	if cleaned == "" {
		return
	}

	q, ok := s.queues[key]
	if !ok {
		q = &sessionQueue{}
		s.queues[key] = q
	}
	now := time.Now()
	q.lastActivity = now

	normalizedContext := q.lastContextKey
	if normalizedContext == "" || !contextKeyMatches(normalizedContext, contextKey) {
		normalizedContext = normalizeContextKey(contextKey)
	}

	if q.lastText == cleaned && q.lastContextKey == normalizedContext {
		return
	}

	q.lastContextKey = normalizedContext
	q.lastText = cleaned
	event := SystemEvent{
		Text:      cleaned,
		Timestamp: now.UnixMilli(),
	}
	if len(q.events) == maxEventsPerSession {
		copy(q.events, q.events[1:])
		q.events[len(q.events)-1] = event
	} else {
		q.events = append(q.events, event)
	}
}

// Drain returns all events for a session and clears the queue.
func (s *EventStore) Drain(sessionKey string) []SystemEvent {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := strings.TrimSpace(sessionKey)
	q, ok := s.queues[key]
	if !ok || len(q.events) == 0 {
		return nil
	}

	events := make([]SystemEvent, len(q.events))
	copy(events, q.events)

	// Clear the queue
	q.events = nil
	q.lastText = ""
	q.lastContextKey = ""
	delete(s.queues, key)

	return events
}

// Peek returns the text of all events for a session without clearing the queue.
func (s *EventStore) Peek(sessionKey string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	q, ok := s.queues[strings.TrimSpace(sessionKey)]
	if !ok {
		return nil
	}

	texts := make([]string, len(q.events))
	for i, e := range q.events {
		texts[i] = e.Text
	}
	return texts
}

// HasEvents checks if a session has any pending system events.
func (s *EventStore) HasEvents(sessionKey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	q, ok := s.queues[strings.TrimSpace(sessionKey)]
	return ok && q != nil && len(q.events) > 0
}

// IsContextChanged checks if the context key for a session has changed.
func (s *EventStore) IsContextChanged(sessionKey, contextKey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	q, ok := s.queues[strings.TrimSpace(sessionKey)]
	if !ok {
		return true
	}

	return !contextKeyMatches(q.lastContextKey, contextKey)
}

// Cleanup removes stagnant session queues older than the specified TTL.
func (s *EventStore) Cleanup(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for key, q := range s.queues {
		if now.Sub(q.lastActivity) > ttl {
			delete(s.queues, key)
		}
	}
}

func normalizeContextKey(contextKey string) string {
	trimmed := strings.TrimSpace(contextKey)
	for i := 0; i < len(trimmed); i++ {
		c := trimmed[i]
		if ('A' <= c && c <= 'Z') || c >= utf8.RuneSelf {
			return strings.ToLower(trimmed)
		}
	}
	return trimmed
}

func contextKeyMatches(normalized, contextKey string) bool {
	trimmed := strings.TrimSpace(contextKey)
	return normalized == trimmed || strings.EqualFold(normalized, trimmed)
}
