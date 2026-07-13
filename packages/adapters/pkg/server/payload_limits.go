package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

const (
	// VercelFunctionPayloadLimitBytes is the documented request or response body limit for Vercel Functions.
	VercelFunctionPayloadLimitBytes = 4_500_000

	// VercelFunctionSafeJSONPayloadBytes leaves headroom for JSON envelopes, headers, bridge encoding, and future fields.
	VercelFunctionSafeJSONPayloadBytes = 3 * 1024 * 1024

	// VercelFunctionSafeBinaryPayloadBytes leaves headroom under the Vercel Function response body limit.
	VercelFunctionSafeBinaryPayloadBytes = 4 * 1024 * 1024
)

var ErrPayloadBudgetExceeded = errors.New("payload budget exceeded")

func JSONPayloadSize(value any) (int, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return 0, fmt.Errorf("marshal JSON payload: %w", err)
	}
	return len(payload), nil
}

func EnsureJSONPayloadWithinBudget(value any, budgetBytes int) (int, error) {
	size, err := JSONPayloadSize(value)
	if err != nil {
		return 0, err
	}
	if budgetBytes > 0 && size > budgetBytes {
		return size, ErrPayloadBudgetExceeded
	}
	return size, nil
}

func TrimSliceForJSONBudget[T any](items []T, build func([]T) any, budgetBytes int) ([]T, bool, int, error) {
	if build == nil {
		return nil, false, 0, errors.New("build JSON payload: nil builder")
	}
	trimmed := false
	for {
		size, err := JSONPayloadSize(build(items))
		if err != nil {
			return nil, trimmed, 0, err
		}
		if budgetBytes <= 0 || size <= budgetBytes {
			return items, trimmed, size, nil
		}
		if len(items) == 0 {
			return items, true, size, ErrPayloadBudgetExceeded
		}
		items = items[:len(items)-1]
		trimmed = true
	}
}

func BinaryPayloadExceedsVercelLimit(sizeBytes int64) bool {
	return sizeBytes > int64(VercelFunctionSafeBinaryPayloadBytes)
}

func PayloadTooLargeError(message string) error {
	return huma.NewError(http.StatusRequestEntityTooLarge, message)
}
