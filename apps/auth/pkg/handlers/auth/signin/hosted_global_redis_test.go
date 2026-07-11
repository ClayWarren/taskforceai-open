package signin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func TestHostedHandler_GlobalWithRedisLimiter(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")
	t.Setenv("AUTH_URL", "https://auth.example.com")

	originalFactory := hostedWorkOSFactory
	hostedWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
		return &testutils.MockWorkOSClient{AuthURL: "https://workos.example.com/login"}
	}
	t.Cleanup(func() { hostedWorkOSFactory = originalFactory })

	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.11")
	rr := httptest.NewRecorder()
	HostedHandler(rr, req)

	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d", rr.Code)
	}
}
