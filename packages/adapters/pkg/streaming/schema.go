package streaming

import (
	"encoding/json"
	"errors"

	"github.com/TaskForceAI/adapters/pkg/utils"
)

var (
	// ErrInvalidJSON indicates that the input string is not valid JSON.
	ErrInvalidJSON = errors.New("INVALID_JSON")
	// ErrInvalidPayload indicates that the input JSON does not match the expected schema.
	ErrInvalidPayload = errors.New("INVALID_PAYLOAD")
)

// ParseStreamingPayload unmarshals a JSON string into a StreamingPayload struct.
func ParseStreamingPayload(raw string) utils.Result[StreamingPayload] {
	if raw == "" {
		return utils.Err[StreamingPayload](ErrInvalidPayload)
	}

	var payload StreamingPayload
	err := json.Unmarshal([]byte(raw), &payload)
	if err != nil {
		if _, ok := errors.AsType[*json.SyntaxError](err); ok {
			return utils.Err[StreamingPayload](ErrInvalidJSON)
		}
		return utils.Err[StreamingPayload](ErrInvalidPayload)
	}

	return utils.Ok[StreamingPayload](payload)
}
