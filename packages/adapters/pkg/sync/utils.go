package sync

import (
	"encoding/json"
	"errors"

	"github.com/TaskForceAI/adapters/pkg/utils"
)

var (
	// ErrEmptyEvent indicates that the input string for a broadcast event is empty.
	ErrEmptyEvent = errors.New("EMPTY_EVENT")
)

// ParseBroadcastEvent unmarshals a JSON string into a BroadcastEvent struct.
func ParseBroadcastEvent(raw string) utils.Result[BroadcastEvent] {
	if raw == "" {
		return utils.Err[BroadcastEvent](ErrEmptyEvent)
	}

	var event BroadcastEvent
	err := json.Unmarshal([]byte(raw), &event)
	if err != nil {
		if _, ok := errors.AsType[*json.SyntaxError](err); ok {
			return utils.Err[BroadcastEvent](ErrInvalidJSON)
		}
		return utils.Err[BroadcastEvent](ErrInvalidSchema)
	}
	if err := event.Validate(); err != nil {
		return utils.Err[BroadcastEvent](ErrInvalidSchema)
	}
	return utils.Ok[BroadcastEvent](event)
}
