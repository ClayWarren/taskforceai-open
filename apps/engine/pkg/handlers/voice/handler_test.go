package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type limiterCall struct {
	key    string
	limit  int
	window time.Duration
}

type fakeLimiter struct {
	result *ratelimit.RateLimitResult
	err    error
	calls  []limiterCall
}

func (f *fakeLimiter) Check(_ context.Context, key string, limit int, window time.Duration) (*ratelimit.RateLimitResult, error) {
	f.calls = append(f.calls, limiterCall{key: key, limit: limit, window: window})
	return f.result, f.err
}

func (f *fakeLimiter) CheckOrg(context.Context, int32, int, time.Duration) (*ratelimit.RateLimitResult, error) {
	return nil, errors.New("unexpected organization limit check")
}

func setupVoiceRouter(user *auth.AuthenticatedUser, limiterProvider LimiterProvider, usageWriters ...UsageWriter) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			ctx := request.Context()
			if user != nil {
				ctx = context.WithValue(ctx, adapterhandler.UserContextKey, user)
				ctx = context.WithValue(ctx, adapterhandler.AuthMethodContextKey, adapterhandler.AuthMethodSession)
			}
			next.ServeHTTP(w, request.WithContext(ctx))
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Voice Test API", "1.0.0"))
	RegisterHandlers(api, limiterProvider, usageWriters...)
	return r
}

func completeRequest(operation string) *http.Request {
	body := bytes.NewBufferString(`{"operation":"` + operation + `","model":"voice-model","quantity":10,"unit":"characters"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/voice/complete", body)
	request.Header.Set("Content-Type", "application/json")
	return request
}

func reserveRequest(operation string) *http.Request {
	body := bytes.NewBufferString(`{"operation":"` + operation + `"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/voice/reserve", body)
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestReserveVoiceOperationUsesAuthenticatedUserAndOperationPolicy(t *testing.T) {
	resetAt := time.Now().Add(45 * time.Second).UTC()
	tests := []struct {
		operation string
		limit     int
	}{
		{operation: "realtime-setup", limit: 6},
		{operation: "speech", limit: 12},
		{operation: "dictation", limit: 12},
	}

	for _, tt := range tests {
		t.Run(tt.operation, func(t *testing.T) {
			limiter := &fakeLimiter{result: &ratelimit.RateLimitResult{
				Allowed:   true,
				Remaining: tt.limit - 1,
				ResetTime: resetAt,
			}}
			router := setupVoiceRouter(
				&auth.AuthenticatedUser{ID: 42, Email: "voice@example.com"},
				func() (ratelimit.Limiter, error) { return limiter, nil },
			)

			response := httptest.NewRecorder()
			router.ServeHTTP(response, reserveRequest(tt.operation))

			require.Equal(t, http.StatusOK, response.Code)
			var body reservation
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			assert.Equal(t, reservation{
				Allowed:           true,
				Limit:             tt.limit,
				Remaining:         tt.limit - 1,
				ResetAt:           resetAt.UnixMilli(),
				RetryAfterSeconds: 0,
			}, body)
			require.Len(t, limiter.calls, 1)
			assert.Equal(t, limiterCall{key: tt.operation + ":42", limit: tt.limit, window: time.Minute}, limiter.calls[0])
		})
	}
}

func TestVoiceCostMicrosUsesProviderBillingUnits(t *testing.T) {
	assert.Equal(t, int64(150), voiceCostMicros(coreusage.VoiceOperationSpeech, 10))
	assert.Equal(t, int64(280), voiceCostMicros(coreusage.VoiceOperationDictation, 10))
	assert.Zero(t, voiceCostMicros(coreusage.VoiceOperationRealtimeSetup, 1))
	assert.Zero(t, voiceCostMicros(coreusage.VoiceOperation("unknown"), 1))
}

func TestCompleteVoiceOperation(t *testing.T) {
	plan := "pro"
	user := &auth.AuthenticatedUser{ID: 42, Plan: &plan}

	t.Run("rejects unsupported operations", func(t *testing.T) {
		response := httptest.NewRecorder()
		setupVoiceRouter(user, nil, func(context.Context, coreusage.EventRow) error { return nil }).ServeHTTP(response, completeRequest("unsupported"))
		assert.Equal(t, http.StatusUnprocessableEntity, response.Code)
	})

	t.Run("requires a usage writer", func(t *testing.T) {
		response := httptest.NewRecorder()
		setupVoiceRouter(user, nil).ServeHTTP(response, completeRequest("speech"))
		assert.Equal(t, http.StatusServiceUnavailable, response.Code)
	})

	t.Run("records completed usage", func(t *testing.T) {
		var recorded coreusage.EventRow
		response := httptest.NewRecorder()
		setupVoiceRouter(user, nil, func(_ context.Context, row coreusage.EventRow) error {
			recorded = row
			return nil
		}).ServeHTTP(response, completeRequest("speech"))
		require.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, response.Body.String(), `"recorded":true`)
		assert.Equal(t, int64(150), recorded.CostMicros)
		assert.Equal(t, "pro", *recorded.Plan)
	})

	t.Run("fails closed when persistence fails", func(t *testing.T) {
		response := httptest.NewRecorder()
		setupVoiceRouter(&auth.AuthenticatedUser{ID: 42}, nil, func(context.Context, coreusage.EventRow) error {
			return errors.New("write failed")
		}).ServeHTTP(response, completeRequest("dictation"))
		assert.Equal(t, http.StatusServiceUnavailable, response.Code)
	})
}

func TestReserveVoiceOperationReturnsAuthoritativeDenial(t *testing.T) {
	resetAt := time.Now().Add(30 * time.Second).UTC()
	limiter := &fakeLimiter{result: &ratelimit.RateLimitResult{
		Allowed:   false,
		Remaining: 0,
		ResetTime: resetAt,
	}}
	router := setupVoiceRouter(
		&auth.AuthenticatedUser{ID: 7, Email: "voice@example.com"},
		func() (ratelimit.Limiter, error) { return limiter, nil },
	)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, reserveRequest("speech"))

	require.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"allowed":false`)
	assert.Contains(t, response.Body.String(), `"retryAfterSeconds":`)
}

func TestReserveVoiceOperationIsSharedAcrossEngineInstances(t *testing.T) {
	client := infraredis.NewMockClient()
	provider := func() (ratelimit.Limiter, error) {
		return ratelimit.NewRedisLimiter(client, "rl:voice"), nil
	}
	user := &auth.AuthenticatedUser{ID: 19, Email: "shared@example.com"}
	firstInstance := setupVoiceRouter(user, provider)
	secondInstance := setupVoiceRouter(user, provider)

	for requestNumber := 0; requestNumber < 6; requestNumber++ {
		response := httptest.NewRecorder()
		if requestNumber%2 == 0 {
			firstInstance.ServeHTTP(response, reserveRequest("realtime-setup"))
		} else {
			secondInstance.ServeHTTP(response, reserveRequest("realtime-setup"))
		}
		require.Equal(t, http.StatusOK, response.Code)
		var body reservation
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		assert.True(t, body.Allowed)
	}

	deniedResponse := httptest.NewRecorder()
	secondInstance.ServeHTTP(deniedResponse, reserveRequest("realtime-setup"))
	require.Equal(t, http.StatusOK, deniedResponse.Code)
	var denied reservation
	require.NoError(t, json.Unmarshal(deniedResponse.Body.Bytes(), &denied))
	assert.False(t, denied.Allowed)
	assert.Zero(t, denied.Remaining)
	assert.Positive(t, denied.RetryAfterSeconds)
}

func TestReserveVoiceOperationFailsClosed(t *testing.T) {
	router := setupVoiceRouter(
		&auth.AuthenticatedUser{ID: 7, Email: "voice@example.com"},
		func() (ratelimit.Limiter, error) { return nil, errors.New("redis unavailable") },
	)

	response := httptest.NewRecorder()
	router.ServeHTTP(response, reserveRequest("dictation"))

	assert.Equal(t, http.StatusServiceUnavailable, response.Code)
}

func TestReserveVoiceOperationRequiresSessionAuthentication(t *testing.T) {
	router := setupVoiceRouter(nil, func() (ratelimit.Limiter, error) {
		return &fakeLimiter{}, nil
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, reserveRequest("realtime-setup"))

	assert.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestReserveVoiceOperationRejectsInvalidAuthenticatedUserID(t *testing.T) {
	router := setupVoiceRouter(&auth.AuthenticatedUser{ID: 0}, func() (ratelimit.Limiter, error) {
		return &fakeLimiter{}, nil
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, reserveRequest("speech"))

	assert.Equal(t, http.StatusBadRequest, response.Code)
}

func TestReserveVoiceOperationFailureBranches(t *testing.T) {
	ctx := context.Background()

	_, err := reserveVoiceOperation(ctx, 7, coreusage.VoiceOperation("unsupported"), nil)
	require.Error(t, err)

	_, err = reserveVoiceOperation(ctx, 7, coreusage.VoiceOperationSpeech, nil)
	require.Error(t, err)

	_, err = reserveVoiceOperation(ctx, 7, coreusage.VoiceOperationSpeech, func() (ratelimit.Limiter, error) {
		return nil, nil
	})
	require.Error(t, err)

	_, err = reserveVoiceOperation(ctx, 7, coreusage.VoiceOperationSpeech, func() (ratelimit.Limiter, error) {
		return &fakeLimiter{err: errors.New("check failed")}, nil
	})
	require.Error(t, err)

	_, err = reserveVoiceOperation(ctx, 7, coreusage.VoiceOperationSpeech, func() (ratelimit.Limiter, error) {
		return &fakeLimiter{}, nil
	})
	require.Error(t, err)
}
