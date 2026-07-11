package handler

import (
	"fmt"
	"net/http"
	"time"
)

// SetRateLimitHeaders writes standard rate limit headers to the response.
func SetRateLimitHeaders(w http.ResponseWriter, limit int, remaining int, resetTime time.Time) {
	w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
	w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
	w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", resetTime.Unix()))
}

// SetRateLimitDeniedHeaders writes standard headers for denied requests.
func SetRateLimitDeniedHeaders(w http.ResponseWriter, limit int, resetTime time.Time) {
	w.Header().Set("Retry-After", fmt.Sprintf("%d", RetryAfterSeconds(resetTime)))
	SetRateLimitHeaders(w, limit, 0, resetTime)
}

// RetryAfterSeconds returns a minimum retry-after duration in whole seconds.
func RetryAfterSeconds(resetTime time.Time) int {
	retryAfter := int(time.Until(resetTime).Seconds())
	if retryAfter <= 0 {
		return 1
	}
	if retryAfter > 2147483647 {
		return 2147483647
	}
	return retryAfter
}
