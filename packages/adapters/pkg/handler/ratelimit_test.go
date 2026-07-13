package handler

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSetRateLimitHeaders(t *testing.T) {
	rr := httptest.NewRecorder()
	resetTime := time.Unix(1735689600, 0)

	SetRateLimitHeaders(rr, 10, 7, resetTime)

	assert.Equal(t, "10", rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "7", rr.Header().Get("X-RateLimit-Remaining"))
	assert.Equal(t, "1735689600", rr.Header().Get("X-RateLimit-Reset"))
}

func TestSetRateLimitDeniedHeaders(t *testing.T) {
	rr := httptest.NewRecorder()
	resetTime := time.Now().Add(3 * time.Second)

	SetRateLimitDeniedHeaders(rr, 10, resetTime)

	assert.Equal(t, "10", rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", rr.Header().Get("X-RateLimit-Remaining"))
	assert.NotEmpty(t, rr.Header().Get("Retry-After"))
}

func TestRetryAfterSeconds_ClampsToOne(t *testing.T) {
	assert.Equal(t, 1, RetryAfterSeconds(time.Now().Add(-1*time.Second)))
}

func TestRetryAfterSeconds_ClampsLargeValues(t *testing.T) {
	assert.Equal(t, 2147483647, RetryAfterSeconds(time.Now().Add(time.Duration(1<<62))))
}
