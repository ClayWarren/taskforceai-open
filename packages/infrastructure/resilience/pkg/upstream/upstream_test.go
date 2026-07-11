package upstream

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/stretchr/testify/assert"
)

var (
	errBenchmarkHTTPStatus        = errors.New("request failed: status_code=429")
	errBenchmarkProvider          = errors.New("quota exceeded")
	errBenchmarkPermanent         = errors.New("max tokens must be <= 500")
	errBenchmarkBillingHTTPStatus = errors.New("stripe request failed: http status 503")
	benchmarkErrorContainsMatch   bool
)

func TestIsTransientError(t *testing.T) {
	assert.False(t, IsTransientError(nil))
	assert.False(t, IsTransientError(errors.New("bad request")))
	assert.True(t, IsTransientError(errors.New("upstream timeout")))
	assert.True(t, IsTransientError(errors.New("connection timed out")))
	assert.True(t, IsTransientError(errors.New("operation timed out")))
	assert.True(t, IsTransientError(context.DeadlineExceeded))
	assert.True(t, IsTransientError(errors.New("502")))
	assert.True(t, IsTransientError(errors.New("500 internal server error")))
	assert.True(t, IsTransientError(errors.New("HTTP 503 service unavailable")))
	assert.True(t, IsTransientError(errors.New("request failed: status_code=429")))
	assert.True(t, IsTransientError(errors.New(`Post "https://api.example.com": 429 Too Many Requests`)))
	assert.True(t, IsTransientError(errors.New("googleapi: Error 429: quota exceeded")))
	assert.True(t, IsTransientError(errors.New("proxy error 429_ratelimited")))
	assert.True(t, IsTransientError(errors.New("upstream service unavailable")))
	assert.False(t, IsTransientError(errors.New("max tokens must be <= 500")))
	assert.False(t, IsTransientError(errors.New("500token validation failed")))
	assert.False(t, IsTransientError(errors.New("request id req_429abc failed validation")))
	assert.True(t, IsTransientError(errors.New("quota exceeded"), "quota exceeded"))
}

func TestErrorContainsAnyIsCaseInsensitive(t *testing.T) {
	assert.False(t, ErrorContainsAny(nil, "timeout"))
	assert.True(t, ErrorContainsAny(errors.New("RATE_LIMIT"), "rate_limit"))
	assert.False(t, ErrorContainsAny(errors.New("permanent failure"), "timeout"))
}

func TestStatusCodeHelpers(t *testing.T) {
	assert.False(t, isStatusCodeFragment("50x"))
	assert.False(t, isStatusCodeFragment("5000"))

	assert.True(t, isBoundaryAfterStatusCode("500", len("500")))
	assert.True(t, isBoundaryAfterStatusCode("500:", len("500")))
	assert.True(t, isBoundaryAfterStatusCode("500_rate_limited", len("500")))
	assert.True(t, hasStatusCodeBoundaryAfter("error 429_ratelimited", len("error 429")))
	assert.False(t, isBoundaryAfterStatusCode("500token", len("500")))
}

func TestDefaultTransientFragmentsReturnsCopy(t *testing.T) {
	fragments := DefaultTransientFragments()
	fragments[0] = "definitely not a retry signal"

	assert.True(t, IsTransientError(errors.New("rate limit exceeded")))
}

func TestCommonTransientFragmentsMutationDoesNotAffectClassifier(t *testing.T) {
	original := CommonTransientFragments
	t.Cleanup(func() {
		CommonTransientFragments = original
	})

	CommonTransientFragments = []string{"permanent failure"}

	assert.False(t, IsTransientError(errors.New("permanent failure")))
	assert.True(t, IsTransientError(errors.New("rate limit exceeded")))
}

func TestStatusKeywordSeparatorEdges(t *testing.T) {
	assert.False(t, hasCompoundKeywordSuffix("status", len("status"), "http", "status"))

	end, ok := trimStatusSeparatorBack("statuscode", len("status"))
	assert.False(t, ok)
	assert.Equal(t, len("status"), end)
}

func TestNewCircuitBreakerUsesUpstreamDefaults(t *testing.T) {
	permanentErr := errors.New("permanent")
	cb := NewCircuitBreaker("test-upstream", 10*time.Millisecond, func(err error) bool {
		return !errors.Is(err, permanentErr)
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return permanentErr })
	assert.Equal(t, circuitbreaker.StateClosed, cb.State())

	for range 4 {
		_ = cb.Execute(ctx, func() error { return errors.New("timeout") })
		assert.Equal(t, circuitbreaker.StateClosed, cb.State())
	}

	_ = cb.Execute(ctx, func() error { return errors.New("timeout") })
	assert.Equal(t, circuitbreaker.StateOpen, cb.State())

	time.Sleep(20 * time.Millisecond)
	assert.Equal(t, circuitbreaker.StateHalfOpen, cb.State())
}

func BenchmarkIsTransientErrorStatusCode(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		benchmarkErrorContainsMatch = IsTransientError(errBenchmarkHTTPStatus)
	}
}

func BenchmarkIsTransientErrorProviderFragment(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		benchmarkErrorContainsMatch = IsTransientError(errBenchmarkProvider, "quota exceeded")
	}
}

func BenchmarkIsTransientErrorPermanentError(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		benchmarkErrorContainsMatch = IsTransientError(errBenchmarkPermanent)
	}
}

func BenchmarkErrorContainsAnyBillingFragments(b *testing.B) {
	fragments := []string{"timeout", "connection refused", "rate_limit", "500", "502", "503", "504"}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkErrorContainsMatch = ErrorContainsAny(errBenchmarkBillingHTTPStatus, fragments...)
	}
}
