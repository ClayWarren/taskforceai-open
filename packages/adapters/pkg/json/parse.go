package json

import (
	"encoding/json"
	"errors"

	"github.com/TaskForceAI/adapters/pkg/utils"
)

var (
	ErrInvalidJSON   = errors.New("INVALID_JSON")
	ErrInvalidSchema = errors.New("INVALID_SCHEMA")
	ErrEmptyInput    = errors.New("EMPTY_INPUT")
)

// ParseJSONSchema unmarshals a JSON string into a target type and returns it wrapped in a Result.
func ParseJSONSchema[T any](raw string) utils.Result[T] {
	var target T
	if raw == "" {
		return utils.Err[T](ErrEmptyInput)
	}

	err := json.Unmarshal([]byte(raw), &target)
	if err != nil {
		if _, ok := errors.AsType[*json.SyntaxError](err); ok {
			return utils.Err[T](ErrInvalidJSON)
		}
		// In Go, Unmarshal also returns errors for type mismatches, which we map to INVALID_SCHEMA.
		return utils.Err[T](ErrInvalidSchema)
	}

	return utils.Ok[T](target)
}

// ParseJSONValueSchema validates a raw value (already unmarshaled or from another source) by attempting to marshal then unmarshal into T.
func ParseJSONValueSchema[T any](raw any) utils.Result[T] {
	if raw == nil {
		return utils.Err[T](ErrEmptyInput)
	}

	if s, ok := raw.(string); ok {
		return ParseJSONSchema[T](s)
	}

	// For non-string raw values, we round-trip through JSON to "validate" against type T.
	data, err := json.Marshal(raw)
	if err != nil {
		return utils.Err[T](ErrInvalidJSON)
	}

	return ParseJSONSchema[T](string(data))
}
