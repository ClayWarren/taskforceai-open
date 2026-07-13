package start

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func startRouter(deps Deps) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	registerHandlerWithDeps(api, deps)
	return r
}

func registerHandlerWithDeps(api huma.API, deps Deps) {
	huma.Register(api, huma.Operation{
		OperationID: "start-device-login-test",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/start",
		Summary:     "Start device login",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
	}) (*struct {
		Status int `status:"201"`
		Body   *auth.DeviceLoginStartPayload
	}, error) {
		return startDeviceLogin(ctx, input.requestInfo, deps)
	})
}

func TestDeviceStartRoute_RegisterHandler_DBUnavailable(t *testing.T) {
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestDeviceStartRoute_RegisterHandler_UsesDefaultDeps(t *testing.T) {
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	previous := registeredStartDeviceLogin
	registeredStartDeviceLogin = func(ctx context.Context, req requestInfo, deps Deps) (*struct {
		Status int `status:"201"`
		Body   *auth.DeviceLoginStartPayload
	}, error) {
		assert.NotNil(t, deps.Service)
		return &struct {
			Status int `status:"201"`
			Body   *auth.DeviceLoginStartPayload
		}{
			Status: http.StatusCreated,
			Body:   &auth.DeviceLoginStartPayload{DeviceCode: "device", UserCode: "user"},
		}, nil
	}
	t.Cleanup(func() { registeredStartDeviceLogin = previous })

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
}

func TestDefaultDepsUsesRedisClient(t *testing.T) {
	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	deps := defaultDeps(&db.Queries{})

	assert.NotNil(t, deps.Service)
	assert.NotNil(t, deps.Limiter)
}

func TestResolveBaseURL(t *testing.T) {
	tests := []struct {
		name          string
		appURL        string
		authURL       string
		allowedDomain string
		host          string
		proto         string
		expected      string
	}{
		{"App URL Env Var", "https://www.taskforce.chat/", "https://auth.taskforce.chat/", "", "localhost:3000", "", "https://www.taskforce.chat"},
		{"AUTH_URL fallback", "", "https://auth.taskforce.chat/", "", "localhost:3000", "", "https://auth.taskforce.chat"},
		{"Untrusted Host Fallback", "", "", "", "example.com", "http", "http://localhost:3000"},
		{"Localhost Default", "", "", "", "localhost:3000", "", "http://localhost:3000"},
		{"Production Default", "", "", "", "taskforceai.chat", "", "https://taskforceai.chat"},
		{"Forwarded Host", "", "", "", "localhost:3000", "", "https://taskforceai.chat"},
		{"Allowed Domain Forwarded Host", "", "", "example.com", "localhost:3000", "https", "https://api.example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.appURL != "" {
				t.Setenv("APP_URL", tt.appURL)
			} else {
				_ = os.Unsetenv("APP_URL")
			}
			if tt.authURL != "" {
				t.Setenv("AUTH_URL", tt.authURL)
			} else {
				_ = os.Unsetenv("AUTH_URL")
			}
			if tt.allowedDomain != "" {
				t.Setenv("ALLOWED_REDIRECT_DOMAIN", tt.allowedDomain)
			} else {
				_ = os.Unsetenv("ALLOWED_REDIRECT_DOMAIN")
			}

			req := httptest.NewRequest(http.MethodPost, "/", nil)
			req.Host = tt.host
			if tt.proto != "" {
				req.Header.Set("X-Forwarded-Proto", tt.proto)
			}
			if tt.name == "Forwarded Host" {
				req.Header.Set("X-Forwarded-Host", "taskforceai.chat")
				req.Header.Set("X-Forwarded-Proto", "https")
			}
			if tt.name == "Allowed Domain Forwarded Host" {
				req.Header.Set("X-Forwarded-Host", "api.example.com")
			}

			assert.Equal(t, tt.expected, resolveBaseURLForTest(req))
		})
	}
}

func TestResolveBaseURL_WebURLAndHostHelpers(t *testing.T) {
	t.Setenv("WEB_URL", "https://app.taskforceai.chat/")
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	assert.Equal(t, "https://app.taskforceai.chat", resolveBaseURLForTest(req))

	_ = os.Unsetenv("WEB_URL")
	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.Host = "127.0.0.1:3000"
	assert.Equal(t, "http://127.0.0.1:3000", resolveBaseURLForTest(req))

	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.Host = "api.taskforceai.chat"
	req.Header.Set("X-Forwarded-Proto", "ftp, https")
	assert.Equal(t, "https://api.taskforceai.chat", resolveBaseURLForTest(req))

	assert.Equal(t, "https://api.taskforceai.chat", resolveBaseURLFromInfo(requestInfo{Host: "api.taskforceai.chat", HasTLS: true}))
}

func resolveBaseURLForTest(r *http.Request) string {
	return resolveBaseURLFromInfo(requestInfo{
		Host:           r.Host,
		ForwardedHost:  r.Header.Get("X-Forwarded-Host"),
		ForwardedProto: r.Header.Get("X-Forwarded-Proto"),
		HasTLS:         r.TLS != nil,
	})
}

func TestHostAndHeaderNormalization(t *testing.T) {
	assert.Equal(t, "first.example", normalizeHeaderValue(" first.example, second.example "))
	assert.Equal(t, "example.com/path", normalizeHostForURL("https://Example.com/path/"))
	assert.Equal(t, "::1", hostName("[::1]:3000"))
	assert.False(t, isLocalHost(""))
	assert.False(t, isTrustedPublicHost(""))
	assert.True(t, isLocalHost("app.localhost:3000"))
	assert.False(t, isTrustedPublicHost("evil.example"))
	assert.Equal(t, "https", normalizeForwardedProto(" HTTPS, http "))
	assert.Empty(t, normalizeForwardedProto("ftp"))
}

func TestDeviceStartRoute_Success(t *testing.T) {
	router := startRouter(Deps{Service: &testutils.MockDeviceService{
		StartPayload: &auth.DeviceLoginStartPayload{
			DeviceCode:      "code",
			UserCode:        "user-code",
			VerificationURI: "https://auth.com/verify",
		},
	}})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	assert.Contains(t, rr.Body.String(), `"device_code":"code"`)
}

func TestDeviceStartRoute_ServiceErrors(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want int
	}{
		{"Unavailable", auth.ErrUnavailable, http.StatusServiceUnavailable},
		{"InternalError", errors.New("generic error"), http.StatusInternalServerError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			router := startRouter(Deps{Service: &testutils.MockDeviceService{StartErr: tt.err}})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			assert.Equal(t, tt.want, rr.Code)
		})
	}
}

func TestDeviceStartRoute_MissingService(t *testing.T) {
	router := startRouter(Deps{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestDeviceStartRoute_MethodNotAllowed(t *testing.T) {
	router := startRouter(Deps{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestDeviceStartRoute_RateLimit(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(100, nil)

	router := startRouter(Deps{
		Service: &testutils.MockDeviceService{},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestCheckRateLimitAllowedAndNoIP(t *testing.T) {
	require.NoError(t, checkRateLimit(context.Background(), nil, nil))

	emptyRedis := new(ratelimit_mocks.RedisClient)
	require.NoError(t, checkRateLimit(context.Background(), nil, ratelimit.NewRedisRateLimiter(emptyRedis, "")))

	ip := "1.2.3.4"
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(1, nil)
	mockRedis.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	limiter := ratelimit.NewRedisRateLimiter(mockRedis, "")

	err := checkRateLimit(context.Background(), &ip, limiter)

	require.NoError(t, err)
	mockRedis.AssertExpectations(t)
}

func TestDeviceStartRoute_ProductionLimiterFailures(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	router := startRouter(Deps{Service: &testutils.MockDeviceService{}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)

	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))
	router = startRouter(Deps{
		Service: &testutils.MockDeviceService{},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr = httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestDeviceStartRoute_LimiterErrorInDevelopmentContinues(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))

	router := startRouter(Deps{
		Service: &testutils.MockDeviceService{
			StartPayload: &auth.DeviceLoginStartPayload{DeviceCode: "d", UserCode: "u"},
		},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
}

func TestClientIPFromRequestInfo(t *testing.T) {
	for _, tc := range []struct {
		name string
		info requestInfo
		want *string
	}{
		{
			name: "rightmost untrusted forwarded for wins outside production",
			info: requestInfo{ForwardedFor: " 1.2.3.4, 5.6.7.8 ", RemoteAddr: "9.9.9.9:1234"},
			want: new("5.6.7.8"),
		},
		{
			name: "remote host port",
			info: requestInfo{RemoteAddr: "9.9.9.9:1234"},
			want: new("9.9.9.9"),
		},
		{
			name: "raw remote fallback",
			info: requestInfo{RemoteAddr: "not-a-host-port"},
			want: new("not-a-host-port"),
		},
		{
			name: "empty",
			info: requestInfo{},
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := clientIPFromRequestInfo(tc.info)
			if tc.want == nil {
				assert.Nil(t, got)
				return
			}
			assert.NotNil(t, got)
			assert.Equal(t, *tc.want, *got)
		})
	}
}

func TestClientIPFromRequestInfoProductionTrustsOnlyProxyForwardedFor(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	got := clientIPFromRequestInfo(requestInfo{ForwardedFor: "1.2.3.4", RemoteAddr: "9.9.9.9:1234"})
	assert.NotNil(t, got)
	assert.Equal(t, "9.9.9.9", *got)

	got = clientIPFromRequestInfo(requestInfo{ForwardedFor: "1.2.3.4, 5.6.7.8", RemoteAddr: "76.76.21.10:1234"})
	assert.NotNil(t, got)
	assert.Equal(t, "5.6.7.8", *got)
}

//go:fix inline
