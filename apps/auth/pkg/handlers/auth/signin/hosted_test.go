package signin

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/mock"
)

func TestGlobalHostedHandler(t *testing.T) {
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	defer func() { _ = os.Unsetenv("WORKOS_CLIENT_ID") }()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/signin/hosted?callbackUrl=http://localhost:3000/dashboard", nil)
	w := httptest.NewRecorder()

	func() {
		defer func() { _ = recover() }()
		HostedHandler(w, req)
	}()
}

func TestHostedHandler(t *testing.T) {
	// Setup environment
	_ = os.Setenv("WORKOS_CLIENT_ID", "client_test_123")
	_ = os.Setenv("AUTH_URL", "https://auth.example.com")
	_ = os.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	_ = os.Setenv("COOKIE_DOMAIN", ".example.com")
	defer func() {
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
		_ = os.Unsetenv("AUTH_URL")
		_ = os.Unsetenv("AUTH_SECRET")
		_ = os.Unsetenv("COOKIE_DOMAIN")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		AuthURL: "https://mock.workos.com/auth",
	}

	h := &HostedHandlerStruct{
		WorkOS: mockWorkOS,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login?callbackUrl=%2Fdashboard", nil)
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()

	// 1. Verify Status Code (Redirect)
	if resp.StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected status 307, got %d", resp.StatusCode)
	}

	// 2. Verify Redirect Location
	location, err := resp.Location()
	if err != nil {
		t.Fatalf("Failed to get location: %v", err)
	}
	if location.String() != "https://mock.workos.com/auth" {
		t.Errorf("Expected redirect to mock URL, got %s", location.String())
	}

	// 3. Verify Cookie (oauth_state)
	cookies := resp.Cookies()
	var stateCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "oauth_state" {
			stateCookie = c
			break
		}
	}

	if stateCookie == nil {
		t.Fatal("oauth_state cookie not set")
	} else if !strings.Contains(stateCookie.Value, ".") {
		t.Errorf("Expected signed state cookie, got %s", stateCookie.Value)
	}
	if stateCookie.Domain != "example.com" && stateCookie.Domain != ".example.com" {
		t.Errorf("Expected cookie domain .example.com, got %s", stateCookie.Domain)
	}
}

func TestHostedHandler_ConfigurationErrorRedirectsToLogin(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	h := &HostedHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d", rr.Code)
	}
	if location := rr.Header().Get("Location"); location != "https://auth.taskforceai.chat/login?error=ConfigurationError" {
		t.Fatalf("unexpected location: %s", location)
	}
}

func TestHostedHandler_ErrorCases(t *testing.T) {
	h := &HostedHandlerStruct{}

	// 1. Method Not Allowed
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rr := serve(h, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rr.Code)
	}

	// 2. Untrusted redirect origin
	req = httptest.NewRequest(http.MethodGet, "/?callbackUrl=https://evil.com", nil)
	rr = serve(h, req)
	if location := rr.Header().Get("Location"); location == "https://evil.com" {
		t.Fatal("expected untrusted callback URL to be rejected")
	}
}

func TestHostedHandler_GlobalWrapper(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")
	t.Setenv("AUTH_URL", "https://auth.example.com")

	originalFactory := hostedWorkOSFactory
	hostedWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
		return &testutils.MockWorkOSClient{AuthURL: "https://workos.example.com/login"}
	}
	t.Cleanup(func() { hostedWorkOSFactory = originalFactory })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	rr := httptest.NewRecorder()
	HostedHandler(rr, req)
	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d", rr.Code)
	}
	if rr.Header().Get("Location") != "https://workos.example.com/login" {
		t.Fatalf("unexpected redirect: %s", rr.Header().Get("Location"))
	}
}

func TestHostedHandler_MissingWorkOSClientID(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "")
	t.Setenv("AUTH_URL", "https://auth.example.com")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	rr := httptest.NewRecorder()
	h := &HostedHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect to login error, got %d", rr.Code)
	}
	if !strings.Contains(rr.Header().Get("Location"), "error=ConfigurationError") {
		t.Fatalf("expected configuration error redirect, got %s", rr.Header().Get("Location"))
	}
}

func TestHostedHandler_PrefersAuthURLForRedirectURI(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test_123")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	defer func() {
		t.Setenv("WORKOS_CLIENT_ID", "")
		t.Setenv("AUTH_URL", "")
		t.Setenv("AUTH_SECRET", "")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		AuthURL: "https://mock.workos.com/auth",
	}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/auth/login?callbackUrl=https%3A%2F%2Fconsole.taskforceai.chat%2Fusage",
		nil,
	)
	serve(h, req)

	if got := mockWorkOS.LastHostedOpts.RedirectURI; got != "https://auth.taskforceai.chat/api/v1/auth/callback" {
		t.Fatalf("expected redirect URI to use AUTH_URL, got %s", got)
	}
}

func TestHostedHandler_RateLimited(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(100, nil)
	h := &HostedHandlerStruct{
		WorkOS:  &testutils.MockWorkOSClient{},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rr.Code)
	}
}

func TestHostedHandler_RateLimiterErrors(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))
	h := &HostedHandlerStruct{
		WorkOS:  &testutils.MockWorkOSClient{},
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rr.Code)
	}
}

func TestHostedHandler_StripsUndefinedCallback(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	mockWorkOS := &testutils.MockWorkOSClient{AuthURL: "https://mock.workos.com/auth"}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}

	rr := doGet(h, "/api/v1/auth/login?callbackUrl=undefined")

	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d", rr.Code)
	}
	if strings.Contains(mockWorkOS.LastHostedOpts.State, "undefined") {
		t.Fatalf("expected undefined callback to be stripped, got %s", mockWorkOS.LastHostedOpts.State)
	}
}

func TestHostedHandler_UnsignedCallbackState(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test_123")
	t.Setenv("AUTH_URL", "https://auth.example.com")
	t.Setenv("AUTH_SECRET", "")
	mockWorkOS := &testutils.MockWorkOSClient{AuthURL: "https://mock.workos.com/auth"}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login?callbackUrl=%2Fdashboard", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d", rr.Code)
	}
	if !strings.Contains(mockWorkOS.LastHostedOpts.State, "|") {
		t.Fatalf("expected unsigned callback state payload, got %s", mockWorkOS.LastHostedOpts.State)
	}
}

func TestHostedHandler_MissingAuthSecretRejectedInProduction(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test_123")
	t.Setenv("AUTH_URL", "https://auth.example.com")
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("NODE_ENV", "production")
	mockWorkOS := &testutils.MockWorkOSClient{AuthURL: "https://mock.workos.com/auth"}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login?callbackUrl=%2Fdashboard", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
	if mockWorkOS.LastHostedOpts.State != "" {
		t.Fatalf("expected WorkOS auth URL not to be generated, got state %s", mockWorkOS.LastHostedOpts.State)
	}
}

func TestHostedHandler_UsesCallbackOriginForRedirectURI(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test_123")
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	t.Setenv("AUTH_URL", "")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	defer func() {
		t.Setenv("WORKOS_CLIENT_ID", "")
		t.Setenv("APP_URL", "")
		t.Setenv("AUTH_URL", "")
		t.Setenv("AUTH_SECRET", "")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		AuthURL: "https://mock.workos.com/auth",
	}
	h := &HostedHandlerStruct{WorkOS: mockWorkOS}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/auth/login?callbackUrl=https%3A%2F%2Fconsole.taskforceai.chat%2Fusage",
		nil,
	)
	serve(h, req)

	if got := mockWorkOS.LastHostedOpts.RedirectURI; got != "https://console.taskforceai.chat/api/v1/auth/callback" {
		t.Fatalf("expected redirect URI to use callback origin, got %s", got)
	}
}

func TestHostedRequestHostHelpers(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "example.com")

	if got := normalizeHost(" https://Example.com/path/, ignored "); got != "Example.com/path/" {
		t.Fatalf("unexpected normalized host: %s", got)
	}
	origin, ok := isTrustedRedirectOrigin("https://console.taskforceai.chat/path")
	if !ok || origin != "https://console.taskforceai.chat" {
		t.Fatalf("expected trusted callback origin, got %q %v", origin, ok)
	}
	if _, ok := isTrustedRedirectOrigin("https://evil.example/path"); ok {
		t.Fatal("expected untrusted callback origin")
	}
	if _, ok := isTrustedRedirectOrigin("ftp://console.taskforceai.chat/path"); ok {
		t.Fatal("expected non-https callback origin to be rejected")
	}
	if got := canonicalHost("[::1]:3000"); got != "::1" {
		t.Fatalf("unexpected canonical host: %s", got)
	}
	if !isTrustedRequestHost("api.example.com") {
		t.Fatal("expected allowed domain subdomain to be trusted")
	}
	if isTrustedRequestHost("evil.invalid") {
		t.Fatal("expected unrelated host to be rejected")
	}
}

func TestRequestPublicBaseURLVariants(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Host = "taskforceai.chat"
	req.Header.Set("X-Forwarded-Proto", "ftp")
	if got := requestPublicBaseURL(req); got != "http://taskforceai.chat" {
		t.Fatalf("expected sanitized http base, got %s", got)
	}

	if got := requestPublicBaseURL(nil); got != "" {
		t.Fatalf("expected empty nil request base, got %s", got)
	}
}

func TestResolvePublicBaseURL_FallsBackToAuthURL(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	got := resolvePublicBaseURL(nil, "")
	if got != "https://auth.taskforceai.chat" {
		t.Fatalf("expected AUTH_URL fallback, got %s", got)
	}
}

func TestResolvePublicBaseURL_IgnoresUntrustedRequestHost(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("AUTH_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "attacker.example")

	got := resolvePublicBaseURL(req, "")
	if got != "http://localhost:3000" {
		t.Fatalf("expected localhost fallback for untrusted host, got %s", got)
	}
}

func TestResolvePublicBaseURL_PrefersAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	t.Setenv("WEB_URL", "https://web.taskforceai.chat")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://next.taskforceai.chat")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	got := resolvePublicBaseURL(nil, "")
	if got != "https://www.taskforceai.chat" {
		t.Fatalf("expected APP_URL precedence, got %s", got)
	}
}

func TestResolvePublicBaseURL_PrefersTrustedCallbackOrigin(t *testing.T) {
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	got := resolvePublicBaseURL(nil, "https://console.taskforceai.chat/dashboard")
	if got != "https://console.taskforceai.chat" {
		t.Fatalf("expected callback origin precedence, got %s", got)
	}
}

func TestResolvePublicBaseURL_UsesAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://app.example.com")
	t.Setenv("AUTH_URL", "")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	got := resolvePublicBaseURL(req, "")
	if got != "https://app.example.com" {
		t.Fatalf("expected app url, got %s", got)
	}
}

func TestResolvePublicBaseURL_UsesTrustedCallbackOrigin(t *testing.T) {
	t.Setenv("APP_URL", "")
	got := resolvePublicBaseURL(nil, "https://console.taskforceai.chat/path")
	if got != "https://console.taskforceai.chat" {
		t.Fatalf("expected callback origin, got %s", got)
	}
}

func TestResolvePublicBaseURL_UsesTrustedRequestHost(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("AUTH_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "api.example.com:443")

	got := resolvePublicBaseURL(req, "")
	if got != "https://api.example.com" {
		t.Fatalf("expected trusted forwarded host, got %s", got)
	}
}
