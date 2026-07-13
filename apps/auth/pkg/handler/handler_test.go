package handler

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/db"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type sampleBody struct {
	Name string `json:"name"`
}

func TestReadJSON_Success(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"alex"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	rr := httptest.NewRecorder()
	var dst sampleBody

	err := ReadJSON(rr, req, &dst)
	require.NoError(t, err)
	assert.Equal(t, "alex", dst.Name)
}

func TestReadJSON_UnknownField(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"alex","extra":1}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	rr := httptest.NewRecorder()
	var dst sampleBody

	err := ReadJSON(rr, req, &dst)
	assert.Error(t, err)
}

func TestReadJSON_TrailingData(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"alex"}{"name":"oops"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	rr := httptest.NewRecorder()
	var dst sampleBody

	err := ReadJSON(rr, req, &dst)
	assert.Error(t, err)
}

func TestValidateSecureEnv(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	require.Error(t, ValidateSecureEnv())

	t.Setenv("AUTH_SECRET", "short")
	require.Error(t, ValidateSecureEnv())

	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")
	assert.NoError(t, ValidateSecureEnv())
}

func TestRequireQueries_Error(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	get := func(ctx context.Context) (*db.Queries, error) { return nil, assert.AnError }

	q, ok := RequireQueries(rr, req, get)
	assert.False(t, ok)
	assert.Nil(t, q)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestSetQueriesOverrideAndResolveQueries(t *testing.T) {
	expected := &db.Queries{}
	SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return expected, nil
	})
	t.Cleanup(func() { SetQueriesOverride(nil) })

	q, err := ResolveQueries(context.Background(), nil)

	require.NoError(t, err)
	assert.Same(t, expected, q)
}

func TestResolveQueries_ExplicitGetterWinsOverOverride(t *testing.T) {
	SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("override should not be used")
	})
	t.Cleanup(func() { SetQueriesOverride(nil) })
	expected := &db.Queries{}

	q, err := ResolveQueries(context.Background(), func(context.Context) (*db.Queries, error) {
		return expected, nil
	})

	require.NoError(t, err)
	assert.Same(t, expected, q)
}

func TestRequireQueriesWithStatus_Error(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	get := func(ctx context.Context) (*db.Queries, error) { return nil, assert.AnError }

	q, ok := RequireQueriesWithStatus(rr, req, get, http.StatusServiceUnavailable, "db down")
	assert.False(t, ok)
	assert.Nil(t, q)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestRequireQueries_Success(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	expected := &db.Queries{}

	q, ok := RequireQueries(rr, req, func(context.Context) (*db.Queries, error) {
		return expected, nil
	})

	assert.True(t, ok)
	assert.Same(t, expected, q)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRequireQueriesWithStatus_Success(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	expected := &db.Queries{}

	q, ok := RequireQueriesWithStatus(rr, req, func(context.Context) (*db.Queries, error) {
		return expected, nil
	}, http.StatusServiceUnavailable, "db down")

	assert.True(t, ok)
	assert.Same(t, expected, q)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestShouldUseSecureCookies(t *testing.T) {
	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL", "")

	t.Run("local nil request", func(t *testing.T) {
		assert.False(t, ShouldUseSecureCookies(nil))
	})

	t.Run("production node env", func(t *testing.T) {
		t.Setenv("NODE_ENV", " production ")
		t.Setenv("VERCEL", "")

		assert.True(t, ShouldUseSecureCookies(nil))
	})

	t.Run("vercel env", func(t *testing.T) {
		t.Setenv("NODE_ENV", "")
		t.Setenv("VERCEL", "1")

		assert.True(t, ShouldUseSecureCookies(nil))
	})

	t.Run("forwarded https", func(t *testing.T) {
		t.Setenv("NODE_ENV", "")
		t.Setenv("VERCEL", "")
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Forwarded-Proto", " https, http ")

		assert.True(t, ShouldUseSecureCookies(req))
	})

	t.Run("tls request", func(t *testing.T) {
		t.Setenv("NODE_ENV", "")
		t.Setenv("VERCEL", "")
		req := httptest.NewRequest(http.MethodGet, "https://taskforceai.chat", nil)
		req.TLS = &tls.ConnectionState{}

		assert.True(t, ShouldUseSecureCookies(req))
	})

	t.Run("local http request", func(t *testing.T) {
		t.Setenv("NODE_ENV", "")
		t.Setenv("VERCEL", "")
		req := httptest.NewRequest(http.MethodGet, "http://localhost:3000", nil)
		req.Header.Set("X-Forwarded-Proto", "http")

		assert.False(t, ShouldUseSecureCookies(req))
	})
}

func TestGetRedisClient_NoEnv(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	client := GetRedisClient()
	assert.Nil(t, client)
}

func TestGetClientIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	ip := GetClientIP(req)
	if assert.NotNil(t, ip) {
		assert.Equal(t, "5.6.7.8", *ip)
	}
}

func TestGetUserAgent(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "test-agent")
	ua := GetUserAgent(req)
	if assert.NotNil(t, ua) {
		assert.Equal(t, "test-agent", *ua)
	}
}

func TestGetUserAgent_Missing(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Nil(t, GetUserAgent(req))
}

func TestIsValidEmail(t *testing.T) {
	assert.True(t, IsValidEmail("USER.Name+tag@example.com"))
	assert.True(t, IsValidEmail("user@example.technology"))
	assert.False(t, IsValidEmail("missing-at"))
	assert.False(t, IsValidEmail("user@example..com"))
}

func TestIsAllowedRedirect(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")

	assert.True(t, IsAllowedRedirect(""))
	assert.True(t, IsAllowedRedirect("/dashboard"))
	assert.False(t, IsAllowedRedirect("//evil.example"))
	assert.False(t, IsAllowedRedirect("/../../admin"))
	assert.False(t, IsAllowedRedirect("nota url"))
	assert.False(t, IsAllowedRedirect("javascript:alert(1)"))
	assert.True(t, IsAllowedRedirect("https://taskforceai.chat/settings"))
	assert.True(t, IsAllowedRedirect("https://app.taskforceai.chat/settings"))
	assert.False(t, IsAllowedRedirect("http://taskforceai.chat/settings"))
	assert.False(t, IsAllowedRedirect("https://evil.example/settings"))
}

func TestIsAllowedRedirect_AllowsLocalHTTPOnly(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "localhost")

	assert.True(t, IsAllowedRedirect("http://localhost:3000/settings"))

	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "127.0.0.1")
	assert.True(t, IsAllowedRedirect("http://127.0.0.1:3000/settings"))

	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	assert.False(t, IsAllowedRedirect("http://app.taskforceai.chat/settings"))
}

func TestMaskEmail(t *testing.T) {
	assert.Equal(t, "***", MaskEmail("invalid"))
	assert.Equal(t, "***@example.com", MaskEmail("a@example.com"))
	assert.Equal(t, "al***@example.com", MaskEmail("alex@example.com"))
}

func TestSanitizeMetadata(t *testing.T) {
	input := map[string]any{
		"email":    "user@example.com",
		"token":    "secret",
		"fullname": "Case Folded",
		"profile":  map[string]any{"full_name": "Sam User"},
		"count":    2,
		"nestedOk": map[string]any{"value": "ok"},
	}
	out := SanitizeMetadata(input)
	encoded, _ := json.Marshal(out)
	assert.Contains(t, string(encoded), "***")
	assert.Equal(t, "***", out["fullname"])
	assert.Equal(t, 2, out["count"])
}

func TestIsAllowedRedirect_BlocksBackslashRelativePath(t *testing.T) {
	assert.False(t, IsAllowedRedirect(`/\evil.com`))
	assert.False(t, IsAllowedRedirect(`/\\evil.com`))
}

func TestIsAllowedRedirect_AbsoluteURLWithoutAllowedDomain(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "")
	assert.False(t, IsAllowedRedirect("https://evil.example/path"))
}

func TestIsAllowedRedirect_InvalidURLParse(t *testing.T) {
	assert.False(t, IsAllowedRedirect("https://exa mple.com"))
}

func TestNewHandlerRedisClient(t *testing.T) {
	original := getRedisClientForHandler
	t.Cleanup(func() { getRedisClientForHandler = original })

	getRedisClientForHandler = func() (infraredis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	client, err := newHandlerRedisClient()
	require.Error(t, err)
	assert.Nil(t, client)

	mock := infraredis.NewMockClient()
	getRedisClientForHandler = func() (infraredis.Cmdable, error) {
		return mock, nil
	}
	client, err = newHandlerRedisClient()
	require.NoError(t, err)
	assert.NotNil(t, client)
}

func TestIsAllowedRedirect_EmptyHostAndPortMismatch(t *testing.T) {
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	// An https URL with no host normalizes to an empty host and is rejected.
	assert.False(t, IsAllowedRedirect("https:///path"))

	// A configured port that does not match the redirect URL is rejected.
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "https://taskforceai.chat:8443")
	assert.False(t, IsAllowedRedirect("https://taskforceai.chat/settings"))
	assert.True(t, IsAllowedRedirect("https://taskforceai.chat:8443/settings"))
}

func TestNormalizedAllowedRedirectDomain(t *testing.T) {
	// Scheme is stripped and host:port is split out.
	host, port, ok := normalizedAllowedRedirectDomain("https://taskforceai.chat:8443")
	require.True(t, ok)
	assert.Equal(t, "taskforceai.chat", host)
	assert.Equal(t, "8443", port)

	// A trailing path segment is trimmed.
	host, port, ok = normalizedAllowedRedirectDomain("taskforceai.chat/tenant")
	require.True(t, ok)
	assert.Equal(t, "taskforceai.chat", host)
	assert.Empty(t, port)

	// Empty input is rejected.
	_, _, ok = normalizedAllowedRedirectDomain("   ")
	assert.False(t, ok)

	// A value that normalizes to an empty host is rejected.
	_, _, ok = normalizedAllowedRedirectDomain("[]")
	assert.False(t, ok)
}

func TestSanitizeMetadata_NilInput(t *testing.T) {
	assert.Nil(t, SanitizeMetadata(nil))
}

func TestSanitizeMetadata_NonEmailPII(t *testing.T) {
	out := SanitizeMetadata(map[string]any{"token": "secret", "count": 1})
	assert.Equal(t, "***", out["token"])
	assert.Equal(t, 1, out["count"])
}

func BenchmarkMaskEmail(b *testing.B) {
	for b.Loop() {
		if got := MaskEmail("benchmark.user@example.com"); got == "" {
			b.Fatal("expected masked email")
		}
	}
}

func BenchmarkSanitizeMetadata(b *testing.B) {
	input := map[string]any{
		"email":         "benchmark@example.com",
		"token":         "secret",
		"accessToken":   "access-secret",
		"request_id":    "req_123",
		"count":         2,
		"profile":       map[string]any{"full_name": "Benchmark User", "department": "Research"},
		"authorization": map[string]any{"email_address": "nested@example.com", "role": "admin"},
	}

	b.ReportAllocs()
	for b.Loop() {
		out := SanitizeMetadata(input)
		if out == nil {
			b.Fatal("expected sanitized metadata")
		}
	}
}
