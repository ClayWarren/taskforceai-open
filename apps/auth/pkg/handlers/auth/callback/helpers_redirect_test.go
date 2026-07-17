package callback

import (
	"encoding/base64"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAllowedRedirect_SubdomainSuffix(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	assert.True(t, isAllowedRedirect("https://app.taskforceai.chat/path"))
}

func TestIsAllowedRedirect_RejectsNonHTTPScheme(t *testing.T) {
	assert.False(t, isAllowedRedirect("javascript:alert(1)"))
}

func TestIsAllowedRedirect_RejectsExternalWhenDomainUnset(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "")
	assert.False(t, isAllowedRedirect("https://evil.example/phish"))
}

func TestMaybeConvertToAppURL_UsesWebURL(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "https://web.example.com")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	got := maybeConvertToAppURL("/home")
	assert.Equal(t, "https://web.example.com/home", got)
}

func TestMaybeConvertToAppURL_WWWAllowedDomain(t *testing.T) {
	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "www.taskforceai.chat")
	got := maybeConvertToAppURL("/dash")
	assert.Equal(t, "https://www.taskforceai.chat/dash", got)
}

func TestDetermineRedirectTarget_InvalidStateFallsBackToRoot(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	got := determineRedirectTarget(req, "%%%not-base64%%%")
	assert.Equal(t, "/", got)
}

func TestDetermineRedirectTarget_RejectsUndefinedCandidate(t *testing.T) {
	target := base64.URLEncoding.EncodeToString([]byte("undefined"))
	req := httptest.NewRequest("GET", "/", nil)
	got := determineRedirectTarget(req, target)
	assert.Equal(t, "/", got)
}
