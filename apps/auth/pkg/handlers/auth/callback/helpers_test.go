package callback

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDetermineRedirectTarget_Cookie(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	cookieVal := url.QueryEscape("/from-cookie")
	req.AddCookie(&http.Cookie{Name: "oauth_redirect", Value: cookieVal})
	got := determineRedirectTarget(req, "")
	assert.Equal(t, "/from-cookie", got)
}

func TestDetermineRedirectTarget_CookieUsesAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	cookieVal := url.QueryEscape("/dashboard")
	req.AddCookie(&http.Cookie{Name: "oauth_redirect", Value: cookieVal})
	got := determineRedirectTarget(req, "")
	assert.Equal(t, "https://www.taskforceai.chat/dashboard", got)
}

func TestDetermineRedirectTarget_DecodedStateTarget(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	target := base64.URLEncoding.EncodeToString([]byte("/dashboard"))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	got := determineRedirectTarget(req, target)
	assert.Contains(t, got, "/dashboard")
}

func TestDetermineRedirectTarget_InvalidStateAndCookie(t *testing.T) {
	badTarget := base64.URLEncoding.EncodeToString([]byte("undefined"))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_redirect", Value: "undefined"})
	got := determineRedirectTarget(req, badTarget)
	assert.Equal(t, "/", got)
}

func TestDetermineRedirectTarget_RedirectCookieFallback(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_redirect", Value: "%2Fsettings"})
	got := determineRedirectTarget(req, "")
	assert.Contains(t, got, "/settings")
}

func TestDetermineRedirectTarget_State(t *testing.T) {
	target := base64.URLEncoding.EncodeToString([]byte("/welcome"))
	got := determineRedirectTarget(httptest.NewRequest(http.MethodGet, "/", nil), target)
	assert.Equal(t, "/welcome", got)
}

func TestDetermineRedirectTarget_StateUsesAllowedRedirectDomainFallback(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	target := base64.URLEncoding.EncodeToString([]byte("/login/device?code=ABCD-1234"))
	got := determineRedirectTarget(httptest.NewRequest(http.MethodGet, "/", nil), target)
	assert.Equal(t, "https://www.taskforceai.chat/login/device?code=ABCD-1234", got)
}

func TestDetermineRedirectTarget_StateUsesAppURL(t *testing.T) {
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	target := base64.URLEncoding.EncodeToString([]byte("/login/device?code=ABCD-1234"))
	got := determineRedirectTarget(httptest.NewRequest(http.MethodGet, "/", nil), target)
	assert.Equal(t, "https://www.taskforceai.chat/login/device?code=ABCD-1234", got)
}

func TestIsAllowedRedirect(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "example.com")

	tests := []struct {
		url      string
		expected bool
	}{
		{"", true},
		{"/", true},
		{"/relative", true},
		{"/../../admin", false},
		{`/\\evil.com`, false},
		{"//evil.com", false},
		{"https://example.com", true},
		{"https://sub.example.com", true},
		{"https://evil.com", false},
		{"https://notexample.com", false},
		{"invalid-url", false},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			assert.Equal(t, tt.expected, isAllowedRedirect(tt.url))
		})
	}

	// Test with no domain configured
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "")
	assert.True(t, isAllowedRedirect("/local"))
	assert.False(t, isAllowedRedirect("https://example.com"))
}

func TestIsAllowedRedirect_RejectsBackslashPath(t *testing.T) {
	assert.False(t, isAllowedRedirect(`/evil\path`))
}

func TestMaybeConvertToAppURL_FromAllowedDomain(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	got := maybeConvertToAppURL("/billing")
	assert.Equal(t, "https://www.taskforceai.chat/billing", got)
}

func TestVerifyState_MissingState(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/callback", nil)
	rr := httptest.NewRecorder()

	_, err := verifyState(rr, req)
	assert.Error(t, err)
}

func TestVerifyState_NoCookie_SecretMissing(t *testing.T) {
	_ = os.Unsetenv("AUTH_SECRET")
	req := httptest.NewRequest(http.MethodGet, "/callback?state=abc", nil)
	rr := httptest.NewRecorder()

	_, err := verifyState(rr, req)
	assert.Error(t, err)
}

func TestVerifyState_SignedState_NoCookie(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	stateParam, fullState, err := stateutil.BuildStatePayload("nonce", "/dash", os.Getenv("AUTH_SECRET"))
	require.NoError(t, err)
	assert.NotEmpty(t, stateParam)

	req := httptest.NewRequest(http.MethodGet, "/callback?state="+url.QueryEscape(fullState), nil)
	rr := httptest.NewRecorder()

	_, err = verifyState(rr, req)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "oauth_state cookie missing")
}

func TestVerifyState_SignedState_TamperedTarget(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	stateParam, _, err := stateutil.BuildStatePayload("nonce", "/dash", os.Getenv("AUTH_SECRET"))
	require.NoError(t, err)
	assert.NotEmpty(t, stateParam)

	tamperedTarget := base64.URLEncoding.EncodeToString([]byte("/admin"))
	req := httptest.NewRequest(http.MethodGet, "/callback?state="+url.QueryEscape(stateParam+"|"+tamperedTarget), nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	_, err = verifyState(rr, req)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid state signature")
}

func TestVerifyState_SignedState_WithCookie(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	stateParam, fullState, err := stateutil.BuildStatePayload("nonce", "/dash", os.Getenv("AUTH_SECRET"))
	require.NoError(t, err)
	assert.NotEmpty(t, stateParam)

	req := httptest.NewRequest(http.MethodGet, "/callback?state="+url.QueryEscape(fullState), nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	_, err = verifyState(rr, req)
	assert.NoError(t, err)
}

func TestVerifyState_UnsignedCookieMatch(t *testing.T) {
	_ = os.Setenv("AUTH_SECRET", "")
	req := httptest.NewRequest(http.MethodGet, "/?state=nonce123", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "nonce123"})
	rr := httptest.NewRecorder()
	target, err := verifyState(rr, req)
	require.NoError(t, err)
	assert.Empty(t, target)
}

func TestVerifyState_UnsignedCookieMatchRejectedInProduction(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("VERCEL", "1")
	req := httptest.NewRequest(http.MethodGet, "/?state=nonce123", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "nonce123"})
	rr := httptest.NewRecorder()

	_, err := verifyState(rr, req)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_SECRET is required")
}

func TestVerifyState_WithCookie(t *testing.T) {
	target := base64.URLEncoding.EncodeToString([]byte("/home"))
	req := httptest.NewRequest(http.MethodGet, "/callback?state=abc|"+target, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	res, err := verifyState(rr, req)
	require.NoError(t, err)
	assert.Equal(t, target, res)
	assert.NotEmpty(t, rr.Header().Get("Set-Cookie"))
}
