package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/inngest/inngestgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func TestAuthMiddleware_DatabaseUnavailable(t *testing.T) {
	originalGetQueries := GetQueries
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	}
	t.Cleanup(func() { GetQueries = originalGetQueries })

	handler := AuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not run")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestAuthMiddleware_DelegatesToFlexibleAuth(t *testing.T) {
	originalGetQueries := GetQueries
	originalWithFlexibleAuth := WithFlexibleAuth
	GetQueries = func(context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}
	WithFlexibleAuth = func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			next(w, r)
		}
	}
	t.Cleanup(func() {
		GetQueries = originalGetQueries
		WithFlexibleAuth = originalWithFlexibleAuth
	})

	nextCalled := false
	handler := AuthMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestInngestSignatureVerifier_AllowsUnsignedRequestsInDevelopment(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("INNGEST_SIGNING_KEY", "")

	nextCalled := false
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusAccepted)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(`{"event":"ping"}`))
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusAccepted, resp.Code)
}

func TestInngestSignatureVerifier_RejectsMissingSigningKeyOnVercel(t *testing.T) {
	t.Setenv("VERCEL", "1")
	t.Setenv("INNGEST_SIGNING_KEY", "")

	nextCalled := false
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(`{"event":"ping"}`))
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.False(t, nextCalled)
	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestInngestSignatureVerifier_RejectsOversizedBody(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "secret")
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not run")
	}))

	body := strings.Repeat("a", int(maxInngestBodyBytes)+1)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("X-Inngest-Signature", "t=1&s=deadbeef")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestInngestSignatureVerifier_RejectsUnreadableBody(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "secret")
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not run")
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", errReader{})
	req.Header.Set("X-Inngest-Signature", "t=1&s=deadbeef")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestInngestSignatureVerifier_SkipsNonInngestPaths(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "secret")
	nextCalled := false
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestInngestSignatureVerifier_ValidSignatureForwardsBody(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "secret")
	body := `{"name":"task.execute"}`
	signature, err := inngestgo.Sign(context.Background(), time.Now(), []byte("secret"), []byte(body))
	require.NoError(t, err)

	var readBody string
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		readBody = string(payload)
		w.WriteHeader(http.StatusAccepted)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("X-Inngest-Signature", signature)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusAccepted, resp.Code)
	assert.Equal(t, body, readBody)
}

func TestReadinessMiddlewareBlocksWhenNotReady(t *testing.T) {
	SetEngineReadiness(false, "redis_unavailable")
	t.Cleanup(func() { SetEngineReadiness(true, "") })

	handler := ReadinessMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not run")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Contains(t, resp.Body.String(), "redis_unavailable")
}

func TestReadinessMiddleware_AllowsWhenReady(t *testing.T) {
	SetEngineReadiness(true, "ok")
	t.Cleanup(func() { SetEngineReadiness(true, "") })

	nextCalled := false
	handler := ReadinessMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/run", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestWithServiceHeadersAndCORSPreflight(t *testing.T) {
	handler := WithServiceHeadersAndCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not run for preflight")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/run", nil)
	req.Header.Set("Origin", "https://app.taskforce.ai")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, "engine-service", resp.Header().Get("X-TaskForce-Service"))
}
