package redisutil

import "strings"

// IsKeyNotFoundError normalizes missing-key errors across Redis adapters.
func IsKeyNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "key not found") || strings.Contains(message, "redis: nil")
}

// SupportsEval reports whether a Redis adapter exposes Lua evaluation.
func SupportsEval(client any) bool {
	support, ok := client.(interface{ SupportsEval() bool })
	return ok && support.SupportsEval()
}

// IsStreamUnavailableError recognizes adapters that intentionally omit streams.
func IsStreamUnavailableError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "stream operations require REDIS_URL")
}
