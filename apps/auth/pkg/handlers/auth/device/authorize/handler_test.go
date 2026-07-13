package authorize

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

const testCSRFState = "csrf-test-state"

func authorizeRouter(user *adapterauth.AuthenticatedUser, deps Deps) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				ctx = context.WithValue(ctx, adapterhandler.UserIDContextKey, user.ID)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	registerHandlerWithDeps(api, deps)
	return r
}

func registerHandlerWithDeps(api huma.API, deps Deps) {
	huma.Register(api, huma.Operation{
		OperationID: "authorize-device-login-test",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/authorize",
		Summary:     "Authorize device login",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
		Body AuthorizeRequest
	}) (*struct{ Body AuthorizeResponse }, error) {
		return authorizeDeviceLogin(ctx, input.User.ID, input.requestInfo, input.Body, deps)
	})
}

func authorizePOST(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/authorize", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func addCSRF(req *http.Request, headerToken, cookieToken string) *http.Request {
	if headerToken != "" {
		req.Header.Set("X-CSRF-Token", headerToken)
	}
	if cookieToken != "" {
		req.AddCookie(&http.Cookie{Name: "csrf_token", Value: cookieToken})
	}
	return req
}

func addValidCSRF(req *http.Request) *http.Request {
	return addCSRF(req, testCSRFState, testCSRFState)
}

func TestDeviceAuthorizeRoute_Success(t *testing.T) {
	mockService := new(auth_mocks.DeviceService)
	mockService.On("AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234").Return(nil)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{Service: mockService})

	req := addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"status":"authorized"`)
	mockService.AssertExpectations(t)
}

func TestDeviceAuthorizeRoute_MethodNotAllowed(t *testing.T) {
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/device/authorize", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestDeviceAuthorizeRoute_CSRF(t *testing.T) {
	mockService := new(auth_mocks.DeviceService)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{Service: mockService})

	for _, tc := range []struct {
		name   string
		header string
		cookie string
	}{
		{name: "missing"},
		{name: "missing cookie", header: "csrf-header"},
		{name: "mismatch", header: "csrf-header", cookie: "csrf-cookie"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := addCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`), tc.header, tc.cookie)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			assert.Equal(t, http.StatusForbidden, rr.Code)
			mockService.AssertNotCalled(t, "AuthorizeDeviceLogin", mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func TestDeviceAuthorizeRoute_HeaderOnlyAuthSkipsCSRF(t *testing.T) {
	mockService := new(auth_mocks.DeviceService)
	mockService.On("AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234").Return(nil)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{Service: mockService})

	req := authorizePOST(`{"user_code":"ABCD-1234"}`)
	req.Header.Set("Authorization", "Bearer token")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestDeviceAuthorizeRoute_HeaderAuthWithSessionCookieRequiresCSRF(t *testing.T) {
	mockService := new(auth_mocks.DeviceService)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{Service: mockService})

	for _, tc := range []struct {
		name   string
		header func(*http.Request)
	}{
		{
			name: "bearer with session cookie",
			header: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer token")
			},
		},
		{
			name: "api key with session cookie",
			header: func(req *http.Request) {
				req.Header.Set("x-api-key", "api-key")
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := authorizePOST(`{"user_code":"ABCD-1234"}`)
			req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
			tc.header(req)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)

			assert.Equal(t, http.StatusForbidden, rr.Code)
			mockService.AssertNotCalled(t, "AuthorizeDeviceLogin", mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func TestDeviceAuthorizeRoute_Unauthorized(t *testing.T) {
	router := authorizeRouter(nil, Deps{})
	req := addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestDeviceAuthorizeRoute_RequestValidation(t *testing.T) {
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{})
	for _, tc := range []struct {
		name string
		body string
		want int
	}{
		{"invalid json", `{invalid`, http.StatusBadRequest},
		{"missing code", `{}`, http.StatusUnprocessableEntity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, addValidCSRF(authorizePOST(tc.body)))
			assert.Equal(t, tc.want, rr.Code)
		})
	}
}

func TestDeviceAuthorizeRoute_ServiceMissingAndErrors(t *testing.T) {
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`)))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)

	for _, tt := range []struct {
		name string
		err  error
		want int
	}{
		{"InvalidCode", auth.ErrInvalidCode, http.StatusNotFound},
		{"Expired", auth.ErrExpired, http.StatusGone},
		{"AlreadyUsed", auth.ErrAlreadyUsed, http.StatusConflict},
		{"InternalError", errors.New("generic error"), http.StatusInternalServerError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			mockService := new(auth_mocks.DeviceService)
			mockService.On("AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234").Return(tt.err)
			router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{Service: mockService})
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`)))
			assert.Equal(t, tt.want, rr.Code)
		})
	}
}

func TestDeviceAuthorizeRoute_RateLimit(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(100, nil)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{
		Service: new(auth_mocks.DeviceService),
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})

	req := addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`))
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestDeviceAuthorizeRoute_LimiterErrorFailsClosed(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))
	mockService := new(auth_mocks.DeviceService)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{
		Service: mockService,
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})

	req := addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`))
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	mockService.AssertNotCalled(t, "AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234")
}

func TestDeviceAuthorizeRoute_NilLimiterFailsClosedInProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	mockService := new(auth_mocks.DeviceService)
	router := authorizeRouter(&adapterauth.AuthenticatedUser{ID: 1}, Deps{
		Service: mockService,
	})

	req := addValidCSRF(authorizePOST(`{"user_code":"ABCD-1234"}`))
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	mockService.AssertNotCalled(t, "AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234")
}
