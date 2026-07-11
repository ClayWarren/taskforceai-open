package signin

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/mock"
)

func TestHostedHandler_ErrorsExtra(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		clientID   string
		authURLErr error
		wantStatus int
	}{
		{"MethodNotAllowed", http.MethodPost, "c", nil, http.StatusMethodNotAllowed},
		// NoConfig now redirects to login page with error param instead of returning 500
		{"NoConfig", http.MethodGet, "", nil, http.StatusTemporaryRedirect},
		{"WorkOSFail", http.MethodGet, "c", errors.New("fail"), http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = os.Setenv("WORKOS_CLIENT_ID", tt.clientID)
			defer func() { _ = os.Unsetenv("WORKOS_CLIENT_ID") }()

			mockWorkOS := &testutils.MockWorkOSClient{AuthURLErr: tt.authURLErr}
			h := &HostedHandlerStruct{WorkOS: mockWorkOS}

			req := httptest.NewRequest(tt.method, "/", nil)
			w := serve(h, req)

			if w.Result().StatusCode != tt.wantStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.wantStatus, w.Result().StatusCode)
			}
		})
	}
}

func TestHostedHandler_CallbackURL(t *testing.T) {
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	defer func() { _ = os.Unsetenv("WORKOS_CLIENT_ID") }()

	mockWorkOS := &testutils.MockWorkOSClient{}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}

	w := doGet(h, "/?callbackUrl=https://app.com")

	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected 307, got %d", w.Result().StatusCode)
	}
}

func TestHostedHandler_RateLimitErrorReturnsServiceUnavailable(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "test")

	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))

	h := &HostedHandlerStruct{
		WorkOS:  &testutils.MockWorkOSClient{},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Result().StatusCode)
	}
}
