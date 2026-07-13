package core

import (
	"strconv"
	"strings"
	"time"
)

const (
	RetryInitialDelay      = 2000
	RetryBackoffFactor     = 2
	RetryMaxDelayNoHeaders = 30000
	RetryMaxDelay          = 2147483647
)

type APIError struct {
	Message         string
	IsRetryable     bool
	ResponseHeaders map[string]string
}

func (e *APIError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func RetryDelay(attempt int, err *APIError) int {
	if attempt < 1 {
		attempt = 1
	}

	if err != nil && err.ResponseHeaders != nil {
		if delay, ok := retryDelayFromHeaders(err.ResponseHeaders); ok {
			return delay
		}
		return exponentialDelay(attempt, RetryMaxDelay)
	}
	return exponentialDelay(attempt, RetryMaxDelayNoHeaders)
}

func retryDelayFromHeaders(headers map[string]string) (int, bool) {
	if v, ok := headers["retry-after-ms"]; ok {
		if parsed, e := strconv.ParseFloat(v, 64); e == nil {
			return int(parsed), true
		}
	}
	v, ok := headers["retry-after"]
	if !ok {
		return 0, false
	}
	if parsed, e := strconv.ParseFloat(v, 64); e == nil {
		return int(parsed * 1000), true
	}
	parsed, e := time.Parse(time.RFC1123, v)
	if e != nil {
		return 0, false
	}
	ms := int(time.Until(parsed).Milliseconds())
	return ms, ms > 0
}

func Retryable(err *APIError) string {
	if err == nil || !err.IsRetryable {
		return ""
	}
	if strings.Contains(err.Message, "Overloaded") {
		return "Provider is overloaded"
	}
	return err.Message
}

func exponentialDelay(attempt int, maxDelay int) int {
	delay := RetryInitialDelay
	for i := 1; i < attempt && delay < maxDelay; i++ {
		delay *= RetryBackoffFactor
		if delay > maxDelay {
			return maxDelay
		}
	}
	return delay
}
