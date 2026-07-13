package sync

import (
	"encoding/json"
	"errors"

	"github.com/TaskForceAI/core/pkg/shared"
)

var (
	// ErrEmptyEvent indicates that the input string for a broadcast event is empty.
	ErrEmptyEvent = errors.New("EMPTY_EVENT")
)

// ParseBroadcastEvent unmarshals a JSON string into a BroadcastEvent struct.
func ParseBroadcastEvent(raw string) shared.Result[BroadcastEvent] {
	if raw == "" {
		return shared.Err[BroadcastEvent](ErrEmptyEvent)
	}

	var event BroadcastEvent
	err := json.Unmarshal([]byte(raw), &event)
	if err != nil {
		if _, ok := errors.AsType[*json.SyntaxError](err); ok {
			return shared.Err[BroadcastEvent](ErrInvalidJSON)
		}
		return shared.Err[BroadcastEvent](ErrInvalidSchema)
	}
	if err := event.Validate(); err != nil {
		return shared.Err[BroadcastEvent](ErrInvalidSchema)
	}
	return shared.Ok[BroadcastEvent](event)
}
