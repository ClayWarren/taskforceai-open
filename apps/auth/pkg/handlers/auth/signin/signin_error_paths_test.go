package signin

import (
	"crypto/tls"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/mock"
)

type failingStateReader struct{}

func (failingStateReader) Read([]byte) (int, error) {
	return 0, errors.New("entropy unavailable")
}

func withFailingStateReader(t *testing.T) {
	t.Helper()
	original := stateRandomReader
	stateRandomReader = failingStateReader{}
	t.Cleanup(func() { stateRandomReader = original })
}

func TestSigninHandlersHandleCORSPreflight(t *testing.T) {
	tests := []struct {
		name    string
		handler http.Handler
		path    string
	}{
		{
			name:    "github",
			handler: &GitHubSigninHandlerStruct{},
			path:    "/api/auth/signin/github",
		},
		{
			name:    "google drive",
			handler: &GoogleDriveSigninHandlerStruct{},
			path:    "/api/auth/signin/google-drive",
		},
		{
			name:    "hosted",
			handler: &HostedHandlerStruct{},
			path:    "/api/v1/auth/login",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, tt.path, nil)
			rr := serve(tt.handler, req)
			if rr.Code != http.StatusNoContent {
				t.Fatalf("expected 204, got %d", rr.Code)
			}
		})
	}
}

func TestSigninHandlersReturnErrorWhenStateGenerationFails(t *testing.T) {
	withFailingStateReader(t)

	tests := []struct {
		name     string
		handler  http.Handler
		path     string
		setEnv   func(t *testing.T)
		expected int
	}{
		{
			name:    "github",
			handler: &GitHubSigninHandlerStruct{},
			path:    "/api/auth/signin/github",
			setEnv: func(t *testing.T) {
				t.Setenv("GITHUB_CLIENT_ID", "client")
				t.Setenv("GITHUB_CLIENT_SECRET", "secret")
				t.Setenv("GITHUB_REDIRECT_URL", "https://auth.taskforceai.chat/callback")
			},
			expected: http.StatusInternalServerError,
		},
		{
			name:    "google drive",
			handler: &GoogleDriveSigninHandlerStruct{},
			path:    "/api/auth/signin/google-drive",
			setEnv: func(t *testing.T) {
				t.Setenv("GOOGLE_CLIENT_ID", "client")
				t.Setenv("GOOGLE_CLIENT_SECRET", "secret")
				t.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "https://auth.taskforceai.chat/callback")
			},
			expected: http.StatusInternalServerError,
		},
		{
			name:    "hosted",
			handler: &HostedHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}},
			path:    "/api/v1/auth/login",
			setEnv: func(t *testing.T) {
				t.Setenv("WORKOS_CLIENT_ID", "client")
				t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
			},
			expected: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setEnv(t)
			rr := doGet(tt.handler, tt.path)
			if rr.Code != tt.expected {
				t.Fatalf("expected %d, got %d", tt.expected, rr.Code)
			}
		})
	}
}

func TestHostedRequestHelpersCoverEdgeInputs(t *testing.T) {
	if origin, ok := isTrustedRedirectOrigin("https://:443/path"); ok || origin != "" {
		t.Fatalf("expected empty-host URL to be rejected, got %q %v", origin, ok)
	}
	if isTrustedRequestHost("") {
		t.Fatal("expected empty request host to be rejected")
	}

	req := httptest.NewRequest(http.MethodGet, "https://taskforceai.chat/api/v1/auth/login", nil)
	if got := requestPublicBaseURL(req); got != "https://taskforceai.chat" {
		t.Fatalf("expected TLS request base, got %s", got)
	}

	req = httptest.NewRequest(http.MethodGet, "https://taskforceai.chat/api/v1/auth/login", nil)
	req.TLS = &tls.ConnectionState{}
	req.Header.Set("X-Forwarded-Proto", "ftp")
	if got := requestPublicBaseURL(req); got != "https://taskforceai.chat" {
		t.Fatalf("expected invalid proto to fall back to TLS scheme, got %s", got)
	}

	req = httptest.NewRequest(http.MethodGet, "https://taskforceai.chat/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-Proto", "https, http")
	if got := requestPublicBaseURL(req); got != "https://taskforceai.chat" {
		t.Fatalf("expected first forwarded proto to be used, got %s", got)
	}
}

func TestHostedWriteRateLimitErrorAllowsMissingIP(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	h := &HostedHandlerStruct{
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.RemoteAddr = ""
	rr := httptest.NewRecorder()

	if h.writeRateLimitError(rr, req) {
		t.Fatal("expected missing client IP to skip rate limiting")
	}
	mockRedis.AssertNotCalled(t, "Incr", mock.Anything, mock.Anything)
}

func TestHostedHandlerReturnsErrorWhenStateSigningFails(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")

	original := buildHostedStatePayload
	buildHostedStatePayload = func(string, string, string) (string, string, error) {
		return "", "", errors.New("signing failed")
	}
	t.Cleanup(func() { buildHostedStatePayload = original })

	h := &HostedHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	rr := doGet(h, "/api/v1/auth/login?callbackUrl=%2Fdashboard")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}
