package streaming

import (
	"encoding/json"
	"errors"

	"github.com/TaskForceAI/core/pkg/shared"
)

var (
	// ErrInvalidJSON indicates that the input string is not valid JSON.
	ErrInvalidJSON = errors.New("INVALID_JSON")
	// ErrInvalidPayload indicates that the input JSON does not match the expected schema.
	ErrInvalidPayload = errors.New("INVALID_PAYLOAD")
)

// ParseStreamingPayload unmarshals a JSON string into a StreamingPayload struct.
func ParseStreamingPayload(raw string) shared.Result[StreamingPayload] {
	if raw == "" {
		return shared.Err[StreamingPayload](ErrInvalidPayload)
	}

	var payload StreamingPayload
	err := json.Unmarshal([]byte(raw), &payload)
	if err != nil {
		if _, ok := errors.AsType[*json.SyntaxError](err); ok {
			return shared.Err[StreamingPayload](ErrInvalidJSON)
		}
		return shared.Err[StreamingPayload](ErrInvalidPayload)
	}

	return shared.Ok[StreamingPayload](payload)
}
