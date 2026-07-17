package handler

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

type mockLogger struct {
	errors []string
	warns  []string
}

func (m *mockLogger) Error(msg string, args ...any) {
	m.errors = append(m.errors, msg)
}

func (m *mockLogger) Warn(msg string, args ...any) {
	m.warns = append(m.warns, msg)
}

type mockLimiter struct {
	result   *RateLimitResult
	err      error
	seenKeys []string
}

func (m *mockLimiter) Check(ctx any, key string, limit int, window time.Duration) (*RateLimitResult, error) {
	m.seenKeys = append(m.seenKeys, key)
	return m.result, m.err
}

func (m *mockLimiter) CheckOrg(ctx any, orgID int32, limit int, window time.Duration) (*RateLimitResult, error) {
	return m.result, m.err
}

type mockRedis struct{}

type countingRateLimiter struct {
	counts     map[string]int
	seenOrgIDs []int32
}

func newCountingRateLimiter() *countingRateLimiter {
	return &countingRateLimiter{counts: make(map[string]int)}
}

func (l *countingRateLimiter) Check(_ any, key string, limit int, window time.Duration) (*RateLimitResult, error) {
	return l.consume(key, limit, window), nil
}

func (l *countingRateLimiter) CheckOrg(_ any, orgID int32, limit int, window time.Duration) (*RateLimitResult, error) {
	l.seenOrgIDs = append(l.seenOrgIDs, orgID)
	return l.consume(fmt.Sprintf("org:%d", orgID), limit, window), nil
}

func (l *countingRateLimiter) consume(key string, limit int, window time.Duration) *RateLimitResult {
	l.counts[key]++
	return &RateLimitResult{
		Allowed:   l.counts[key] <= limit,
		Remaining: max(limit-l.counts[key], 0),
		ResetTime: time.Now().Add(window),
	}
}

// okHandler returns an http.Handler that records invocation via called and
// responds 200, collapsing the repeated next-handler setup in these tests.
func okHandler(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

func TestWithOrgRateLimitDeps_RedisUnavailable(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return nil },
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_Allowed(t *testing.T) {
	called := false
	next := okHandler(&called)

	logger := &mockLogger{}
	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		GetClientIP: func(r *http.Request) *string {
			s := "192.168.1.1"
			return &s
		},
		GetLogger: func() Logger { return logger },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(message))
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 99,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "100", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "99", w.Header().Get("X-RateLimit-Remaining"))
}

func TestWithOrgRateLimitDeps_Denied(t *testing.T) {
	called := false
	next := okHandler(&called)

	logger := &mockLogger{}
	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		GetClientIP: func(r *http.Request) *string {
			s := "192.168.1.1"
			return &s
		},
		GetLogger: func() Logger { return logger },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(message))
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   false,
					Remaining: 0,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "100", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", w.Header().Get("X-RateLimit-Remaining"))
	assert.Len(t, logger.warns, 1)
}

func TestWithOrgRateLimitDeps_OrgIDOutOfRange(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int {
			return math.MaxInt32 + 1
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 99,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "organization id out of range")
}

func TestWithOrgRateLimitDeps_AnonUser(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 0 },
		GetClientIP: func(r *http.Request) *string {
			s := "192.168.1.1"
			return &s
		},
		GetLogger: func() Logger { return &mockLogger{} },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 19,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "20", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "19", w.Header().Get("X-RateLimit-Remaining"))
}

func TestWithOrgRateLimitDeps_UnscopedAuthenticatedUserGetsFullLimit(t *testing.T) {
	called := false
	limiter := &mockLimiter{
		result: &RateLimitResult{
			Allowed:   true,
			Remaining: 99,
			ResetTime: time.Now().Add(time.Minute),
		},
	}
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 0 },
		GetUserID: func(r *http.Request) int {
			return 42
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return limiter
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/run", nil)
	w := httptest.NewRecorder()
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "100", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "99", w.Header().Get("X-RateLimit-Remaining"))
	assert.Len(t, limiter.seenKeys, 1)
	assert.Contains(t, limiter.seenKeys[0], "auth:/api/v1/developer/run:user:42")
}

func TestWithOrgRateLimitDeps_UnscopedAPIKeyHeaderUsesAnonLimit(t *testing.T) {
	called := false
	limiter := &mockLimiter{
		result: &RateLimitResult{
			Allowed:   true,
			Remaining: 19,
			ResetTime: time.Now().Add(time.Minute),
		},
	}
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 0 },
		GetClientIP: func(r *http.Request) *string {
			ip := "192.168.1.1"
			return &ip
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return limiter
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/run", nil)
	req.Header.Set("x-api-key", "tfai_test_key")
	w := httptest.NewRecorder()
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "20", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "19", w.Header().Get("X-RateLimit-Remaining"))
	assert.Len(t, limiter.seenKeys, 1)
	assert.Equal(t, "anon:/api/v1/developer/run:192.168.1.1", limiter.seenKeys[0])
}

func TestWithOrgRateLimitDeps_CheckError(t *testing.T) {
	called := false
	next := okHandler(&called)

	logger := &mockLogger{}
	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		GetClientIP: func(r *http.Request) *string {
			s := "192.168.1.1"
			return &s
		},
		GetLogger: func() Logger { return logger },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: nil,
				err:    assert.AnError,
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, logger.errors, 1)
}

func TestWithOrgRateLimitDeps_NilDeps(t *testing.T) {
	called := false
	next := okHandler(&called)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, nil)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_NoClientIP(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis:    func() any { return &mockRedis{} },
		GetOrgID:    func(r *http.Request) int { return 0 },
		GetClientIP: func(r *http.Request) *string { return nil },
		GetLogger:   func() Logger { return &mockLogger{} },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 19,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSetRateLimitDeps(t *testing.T) {
	original := defaultRateLimitDeps
	defer func() { defaultRateLimitDeps = original }()

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
	}
	SetRateLimitDeps(deps)

	assert.NotNil(t, defaultRateLimitDeps.GetRedis)
}

func TestSetRateLimitDeps_Nil(t *testing.T) {
	original := defaultRateLimitDeps
	defer func() { defaultRateLimitDeps = original }()

	SetRateLimitDeps(nil)
}

func TestWithOrgRateLimitDeps_NoNewLimiter(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis:   func() any { return &mockRedis{} },
		NewLimiter: nil,
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_NilLimiter_FailOpen(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_AnonNilLimiter_FailOpen(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 0 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_AnonGetRedisNilFunction_FailOpen(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: nil,
		GetOrgID: func(r *http.Request) int { return 0 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 1,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimitDeps_AnonPathNormalization(t *testing.T) {
	called := 0
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	})

	limiter := &mockLimiter{
		result: &RateLimitResult{
			Allowed:   true,
			Remaining: 19,
			ResetTime: time.Now().Add(time.Minute),
		},
	}

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 0 },
		GetClientIP: func(r *http.Request) *string {
			s := "192.168.1.1"
			return &s
		},
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return limiter
		},
	}

	handler := WithOrgRateLimitDeps(100, time.Minute, deps)(next)

	reqA := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task-1", nil)
	wA := httptest.NewRecorder()
	handler.ServeHTTP(wA, reqA)

	reqB := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task-2", nil)
	wB := httptest.NewRecorder()
	handler.ServeHTTP(wB, reqB)

	assert.Equal(t, http.StatusOK, wA.Code)
	assert.Equal(t, http.StatusOK, wB.Code)
	assert.Equal(t, 2, called)
	assert.Len(t, limiter.seenKeys, 2)
	assert.Equal(t, limiter.seenKeys[0], limiter.seenKeys[1])
	assert.Contains(t, limiter.seenKeys[0], "anon:/api/v1/developer/status:192.168.1.1")
}

func TestWithOrgRateLimitDeps_NilResult_FailOpen(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: nil,
				err:    nil,
			}
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOrgRateLimit_Direct(t *testing.T) {
	original := defaultRateLimitDeps
	defer func() { defaultRateLimitDeps = original }()

	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   true,
					Remaining: 99,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
	}
	SetRateLimitDeps(deps)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimit(100, time.Minute)(next).ServeHTTP(w, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAnonLimit_NegativeOrZero(t *testing.T) {
	assert.Equal(t, 1, anonLimit(0))
	assert.Equal(t, 1, anonLimit(-5))
	assert.Equal(t, 1, anonLimit(4))
}

func TestAnonRateLimitScope(t *testing.T) {
	assert.Equal(t, "/", anonRateLimitScope(""))
	assert.Equal(t, "/", anonRateLimitScope("  "))
	assert.Equal(t, "/", anonRateLimitScope("/"))
	assert.Equal(t, "/foo", anonRateLimitScope("/foo/bar"))
	assert.Equal(t, "/api/v1/developer/status", anonRateLimitScope("/api/v1/developer/status/task-123"))
}

func TestWithOrgRateLimitDeps_UnscopedAuthenticatedRateLimit_NilOrZeroUser(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis:  func() any { return &mockRedis{} },
		GetOrgID:  func(r *http.Request) int { return 0 },
		GetUserID: nil,
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{Allowed: true},
			}
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)
	assert.True(t, called)

	called = false
	deps.GetUserID = func(r *http.Request) int { return 0 }
	w = httptest.NewRecorder()
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)
	assert.True(t, called)
}

func TestWithOrgRateLimitDeps_UnscopedAuthenticatedRateLimit_NilLimiter(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis:  func() any { return &mockRedis{} },
		GetOrgID:  func(r *http.Request) int { return 0 },
		GetUserID: func(r *http.Request) int { return 42 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)
	assert.True(t, called)
}

func TestSetRateLimitDeps_AllFields(t *testing.T) {
	original := defaultRateLimitDeps
	defer func() { defaultRateLimitDeps = original }()

	defaultRateLimitDeps = &RateLimitDeps{}

	d := &RateLimitDeps{
		GetRedis:    func() any { return nil },
		GetOrgID:    func(r *http.Request) int { return 0 },
		GetUserID:   func(r *http.Request) int { return 0 },
		GetClientIP: func(r *http.Request) *string { return nil },
		GetLogger:   func() Logger { return nil },
		JSONError:   func(w http.ResponseWriter, code int, message string) {},
		NewLimiter:  func(redis any, prefix string) RateLimitChecker { return nil },
	}

	SetRateLimitDeps(d)

	assert.NotNil(t, defaultRateLimitDeps.GetRedis)
	assert.NotNil(t, defaultRateLimitDeps.GetOrgID)
	assert.NotNil(t, defaultRateLimitDeps.GetUserID)
	assert.NotNil(t, defaultRateLimitDeps.GetClientIP)
	assert.NotNil(t, defaultRateLimitDeps.GetLogger)
	assert.NotNil(t, defaultRateLimitDeps.JSONError)
	assert.NotNil(t, defaultRateLimitDeps.NewLimiter)
}

func TestWithOrgRateLimitDeps_Denied_NilJSONError(t *testing.T) {
	called := false
	next := okHandler(&called)

	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   false,
					Remaining: 0,
					ResetTime: time.Now().Add(time.Minute),
				},
			}
		},
		JSONError: nil,
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

func TestCheckAnonRateLimit_LimiterNil(t *testing.T) {
	deps := &RateLimitDeps{
		GetRedis:   nil,
		NewLimiter: nil,
	}
	res, err := checkAnonRateLimit(httptest.NewRequest(http.MethodGet, "/test", nil), deps, 100, time.Minute)
	assert.Nil(t, res)
	assert.ErrorIs(t, err, errRateLimiterUnavailable)
}

func TestCheckUnscopedAuthenticatedRateLimit_NilUserID(t *testing.T) {
	deps := &RateLimitDeps{
		GetUserID: nil,
	}
	res, err := checkUnscopedAuthenticatedRateLimit(httptest.NewRequest(http.MethodGet, "/test", nil), deps, 100, time.Minute)
	assert.Nil(t, res)
	assert.ErrorIs(t, err, errRateLimitIdentityUnset)
}

func TestCheckUnscopedAuthenticatedRateLimit_InvalidUserID(t *testing.T) {
	deps := &RateLimitDeps{
		GetUserID: func(r *http.Request) int { return 0 },
	}
	res, err := checkUnscopedAuthenticatedRateLimit(httptest.NewRequest(http.MethodGet, "/test", nil), deps, 100, time.Minute)
	assert.Nil(t, res)
	assert.ErrorIs(t, err, errRateLimitIdentityUnset)
}

func TestCheckUnscopedAuthenticatedRateLimit_LimiterNil(t *testing.T) {
	deps := &RateLimitDeps{
		GetUserID: func(r *http.Request) int { return 10 },
		GetRedis:  nil,
	}
	res, err := checkUnscopedAuthenticatedRateLimit(httptest.NewRequest(http.MethodGet, "/test", nil), deps, 100, time.Minute)
	assert.Nil(t, res)
	assert.ErrorIs(t, err, errRateLimiterUnavailable)
}

func TestAnonRateLimitScope_Empty(t *testing.T) {
	res := anonRateLimitScope("  ")
	assert.Equal(t, "/", res)
}

func TestHandleRateLimitDenied_PastResetTime(t *testing.T) {
	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int { return 123 },
		NewLimiter: func(redis any, prefix string) RateLimitChecker {
			return &mockLimiter{
				result: &RateLimitResult{
					Allowed:   false,
					Remaining: 0,
					ResetTime: time.Now().Add(-10 * time.Second),
				},
			}
		},
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	WithOrgRateLimitDeps(100, time.Minute, deps)(next).ServeHTTP(w, req)

	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "1", w.Header().Get("Retry-After"))
}

func TestRetryAfterSeconds_RoundsUp(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)

	assert.Equal(t, 2, retryAfterSeconds(now.Add(1500*time.Millisecond), now))
	assert.Equal(t, 1, retryAfterSeconds(now, now))
	assert.Equal(t, 1, retryAfterSeconds(now.Add(-time.Second), now))
}

func TestWithOrgRateLimitScope_UsesNamedSharedBudget(t *testing.T) {
	assert.NotNil(t, WithOrgRateLimitScope("developer_read", 120, time.Hour))

	limiter := &mockLimiter{result: &RateLimitResult{
		Allowed:   true,
		Remaining: 119,
		ResetTime: time.Now().Add(time.Hour),
	}}
	prefixes := []string{}
	deps := &RateLimitDeps{
		GetRedis:  func() any { return &mockRedis{} },
		GetOrgID:  func(*http.Request) int { return 0 },
		GetUserID: func(*http.Request) int { return 42 },
		NewLimiter: func(_ any, prefix string) RateLimitChecker {
			prefixes = append(prefixes, prefix)
			return limiter
		},
	}

	called := false
	handler := withOrgRateLimitScopeDeps("developer_read", 120, time.Hour, deps)(okHandler(&called))
	for _, path := range []string{"/api/v1/developer/keys", "/api/v1/developer/usage"} {
		called = false
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		assert.True(t, called)
		assert.Equal(t, http.StatusOK, w.Code)
	}

	assert.Equal(t, []string{
		"auth:developer_read:user:42",
		"auth:developer_read:user:42",
	}, limiter.seenKeys)
	for _, prefix := range prefixes {
		assert.Equal(t, "dev_org_rl:developer_read", prefix)
	}
}

func TestWithOrgRateLimitScope_SharesBudgetAcrossUsersInOrganization(t *testing.T) {
	limiter := newCountingRateLimiter()
	currentUserID := 101
	deps := &RateLimitDeps{
		GetRedis:  func() any { return &mockRedis{} },
		GetOrgID:  func(*http.Request) int { return 777 },
		GetUserID: func(*http.Request) int { return currentUserID },
		NewLimiter: func(_ any, _ string) RateLimitChecker {
			return limiter
		},
		JSONError: func(w http.ResponseWriter, code int, _ string) {
			w.WriteHeader(code)
		},
	}

	handler := withOrgRateLimitScopeDeps("developer_write", 20, 24*time.Hour, deps)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	request := func() int {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", nil))
		return w.Code
	}

	for range 20 {
		assert.Equal(t, http.StatusNoContent, request())
	}
	assert.Equal(t, http.StatusTooManyRequests, request())

	currentUserID = 202
	assert.Equal(t, http.StatusTooManyRequests, request())
	assert.Len(t, limiter.seenOrgIDs, 22)
}

func TestWithUserRateLimitScope_IsolatesUsersInSameOrganization(t *testing.T) {
	assert.NotNil(t, WithUserRateLimitScope("developer_write", 20, 24*time.Hour))

	limiter := newCountingRateLimiter()
	currentUserID := 101
	deps := &RateLimitDeps{
		GetRedis:  func() any { return &mockRedis{} },
		GetOrgID:  func(*http.Request) int { return 777 },
		GetUserID: func(*http.Request) int { return currentUserID },
		NewLimiter: func(_ any, _ string) RateLimitChecker {
			return limiter
		},
		JSONError: func(w http.ResponseWriter, code int, _ string) {
			w.WriteHeader(code)
		},
	}

	handler := withUserRateLimitScopeDeps("developer_write", 20, 24*time.Hour, deps)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	// Requests intentionally omit a body to model attempts that are charged
	// before Huma validates the key mutation payload.
	request := func() int {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", nil))
		return w.Code
	}

	for range 20 {
		assert.Equal(t, http.StatusNoContent, request())
	}
	assert.Equal(t, http.StatusTooManyRequests, request())

	currentUserID = 202
	assert.Equal(t, http.StatusNoContent, request())
	assert.Empty(t, limiter.seenOrgIDs)
	assert.Equal(t, 21, limiter.counts["auth:developer_write:user:101"])
	assert.Equal(t, 1, limiter.counts["auth:developer_write:user:202"])
}

func TestWithUserRateLimitScope_AnonymousUsesReducedIPBudget(t *testing.T) {
	limiter := newCountingRateLimiter()
	clientIP := "203.0.113.10"
	deps := &RateLimitDeps{
		GetRedis:    func() any { return &mockRedis{} },
		GetOrgID:    func(*http.Request) int { return 777 },
		GetUserID:   func(*http.Request) int { return 0 },
		GetClientIP: func(*http.Request) *string { return &clientIP },
		NewLimiter: func(_ any, _ string) RateLimitChecker {
			return limiter
		},
	}

	handler := withUserRateLimitScopeDeps("developer_write", 20, 24*time.Hour, deps)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", nil))

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "4", w.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, 1, limiter.counts["anon:developer_write:203.0.113.10"])
	assert.Empty(t, limiter.seenOrgIDs)
}
