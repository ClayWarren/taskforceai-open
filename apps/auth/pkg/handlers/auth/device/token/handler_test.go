package devicetoken

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func tokenRouter(deps Deps) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	registerHandlerWithDeps(api, deps)
	return r
}

func registerHandlerWithDeps(api huma.API, deps Deps) {
	huma.Register(api, huma.Operation{
		OperationID: "exchange-device-token-test",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/token",
		Summary:     "Exchange device code for token",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
		Body TokenRequest
	}) (*struct {
		Status int
		Body   TokenResponse
	}, error) {
		return exchangeDeviceToken(ctx, input.requestInfo, input.Body, deps)
	})
}

func TestDeviceTokenRoute_RegisterHandler_DBUnavailable(t *testing.T) {
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func tokenPOST(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestDeviceTokenRoute_Success(t *testing.T) {
	t.Setenv("AUTH_SECRET", "secret")

	mockService := new(auth_mocks.DeviceService)
	mockService.On("ExchangeDeviceToken", mock.Anything, "test", "secret").Return(&auth.DeviceLoginTokenOutcome{
		Kind:        "APPROVED",
		AccessToken: "token",
		ExpiresIn:   3600,
	}, nil)

	router := tokenRouter(Deps{Service: mockService})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))

	assert.Equal(t, http.StatusOK, rr.Code)
	mockService.AssertExpectations(t)

	var body map[string]any
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	assert.Equal(t, "APPROVED", body["kind"])
	assert.Equal(t, "approved", body["status"])
	assert.Equal(t, "token", body["access_token"])
	assert.Equal(t, "token", body["accessToken"])
	assert.Equal(t, float64(3600), body["expires_in"])
	assert.Equal(t, float64(3600), body["expiresIn"])
	assert.Equal(t, "bearer", body["token_type"])
}

func TestDeviceTokenRoute_RequestValidation(t *testing.T) {
	router := tokenRouter(Deps{})

	for _, tc := range []struct {
		name string
		body string
		want int
	}{
		{"invalid json", `{invalid`, http.StatusBadRequest},
		{"missing device code", `{}`, http.StatusUnprocessableEntity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, tokenPOST(tc.body))
			assert.Equal(t, tc.want, rr.Code)
		})
	}
}

func TestDeviceTokenRoute_ServiceMissingAndErrors(t *testing.T) {
	t.Setenv("AUTH_SECRET", "secret")

	router := tokenRouter(Deps{})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)

	mockService := new(auth_mocks.DeviceService)
	mockService.On("ExchangeDeviceToken", mock.Anything, "test", "secret").Return(nil, errors.New("exchange failed"))
	router = tokenRouter(Deps{Service: mockService})
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)

	mockService = new(auth_mocks.DeviceService)
	mockService.On("ExchangeDeviceToken", mock.Anything, "test", "secret").Return(nil, nil)
	router = tokenRouter(Deps{Service: mockService})
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestDeviceTokenRoute_Outcomes(t *testing.T) {
	t.Setenv("AUTH_SECRET", "secret")
	email := "user@example.com"
	tests := []struct {
		name       string
		outcome    *auth.DeviceLoginTokenOutcome
		wantStatus int
		wantBody   string
	}{
		{"invalid", &auth.DeviceLoginTokenOutcome{Kind: "INVALID_CODE"}, http.StatusNotFound, "invalid_code"},
		{"expired", &auth.DeviceLoginTokenOutcome{Kind: "EXPIRED"}, http.StatusGone, "expired"},
		{"claimed", &auth.DeviceLoginTokenOutcome{Kind: "ALREADY_CLAIMED"}, http.StatusConflict, "already_claimed"},
		{"invalid user", &auth.DeviceLoginTokenOutcome{Kind: "INVALID_USER"}, http.StatusInternalServerError, "invalid_user"},
		{"unknown", &auth.DeviceLoginTokenOutcome{Kind: "UNKNOWN"}, http.StatusInternalServerError, "error"},
		{"pending", &auth.DeviceLoginTokenOutcome{Kind: "PENDING", Interval: 5, Email: &email}, http.StatusAccepted, "pending"},
		{"slow down", &auth.DeviceLoginTokenOutcome{Kind: "SLOW_DOWN", Interval: 5}, http.StatusTooManyRequests, "slow_down"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockService := new(auth_mocks.DeviceService)
			mockService.On("ExchangeDeviceToken", mock.Anything, "test", "secret").Return(tt.outcome, nil)
			router := tokenRouter(Deps{Service: mockService})
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))

			assert.Equal(t, tt.wantStatus, rr.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
			assert.Equal(t, tt.outcome.Kind, body["kind"])
			assert.Equal(t, tt.wantBody, body["status"])
			switch tt.outcome.Kind {
			case "PENDING":
				assert.Equal(t, float64(5), body["interval"])
				assert.Equal(t, "authorization_pending", body["message"])
				assert.Equal(t, email, body["email"])
			case "SLOW_DOWN":
				assert.Equal(t, float64(5), body["interval"])
				assert.Equal(t, "slow_down", body["message"])
			}
		})
	}
}

func TestDeviceTokenRoute_RateLimit(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(100, nil)

	router := tokenRouter(Deps{
		Service: new(auth_mocks.DeviceService),
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req := tokenPOST(`{"device_code":"test"}`)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestDeviceTokenRoute_ProductionLimiterFailures(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	router := tokenRouter(Deps{Service: new(auth_mocks.DeviceService)})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, tokenPOST(`{"device_code":"test"}`))
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)

	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))
	router = tokenRouter(Deps{
		Service: new(auth_mocks.DeviceService),
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req := tokenPOST(`{"device_code":"test"}`)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestDeviceTokenRoute_LimiterErrorInDevelopmentContinues(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("AUTH_SECRET", "secret")

	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))
	mockService := new(auth_mocks.DeviceService)
	mockService.On("ExchangeDeviceToken", mock.Anything, "test", "secret").Return(&auth.DeviceLoginTokenOutcome{
		Kind: "PENDING",
	}, nil)

	router := tokenRouter(Deps{
		Service: mockService,
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req := tokenPOST(`{"device_code":"test"}`)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusAccepted, rr.Code)
}
