package signin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsTrustedRedirectOrigin_AcceptsTaskforceSubdomain(t *testing.T) {
	origin, ok := isTrustedRedirectOrigin("https://console.taskforceai.chat/app")
	assert.True(t, ok)
	assert.Equal(t, "https://console.taskforceai.chat", origin)
}

func TestIsTrustedRedirectOrigin_RejectsUntrustedHost(t *testing.T) {
	_, ok := isTrustedRedirectOrigin("https://evil.example.com/path")
	assert.False(t, ok)
}

func TestIsTrustedRequestHost_AllowedDomainSuffix(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "example.com")
	assert.True(t, isTrustedRequestHost("api.example.com"))
	assert.False(t, isTrustedRequestHost("example.org"))
}

func TestIsTrustedRequestHost_CustomAllowedDomain(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "corp.example")
	assert.True(t, isTrustedRequestHost("app.corp.example"))
	assert.False(t, isTrustedRequestHost("other.example"))
}

func TestIsTrustedRequestHost_LocalhostSuffix(t *testing.T) {
	assert.True(t, isTrustedRequestHost("api.localhost"))
}

func TestIsTrustedRequestHost_LoopbackIP(t *testing.T) {
	assert.True(t, isTrustedRequestHost("127.0.0.1"))
}

func TestRequestPublicBaseURL_NilRequest(t *testing.T) {
	assert.Empty(t, requestPublicBaseURL(nil))
}

func TestRequestPublicBaseURL_UsesAllowedRedirectDomain(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("AUTH_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "localhost:3000"
	req.Header.Set("X-Forwarded-Host", "api.taskforceai.chat")
	req.Header.Set("X-Forwarded-Proto", "https")

	got := requestPublicBaseURL(req)
	assert.Equal(t, "https://api.taskforceai.chat", got)
}
