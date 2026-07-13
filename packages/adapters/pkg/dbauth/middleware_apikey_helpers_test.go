package dbauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func runAPIKeyMiddleware(
	t *testing.T,
	rawKey string,
	setup func(*middlewareFakeDB, string),
	handler func(http.ResponseWriter, *http.Request),
) (rec *httptest.ResponseRecorder, called bool, fakeDB *middlewareFakeDB) {
	t.Helper()

	keyHash := hashAPIKey(rawKey)
	fakeDB = newMiddlewareFakeDB()
	if setup != nil {
		setup(fakeDB, keyHash)
	}

	called = false
	middleware := WithAPIKey(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		if handler != nil {
			handler(w, r)
		}
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	if rawKey != "" {
		req.Header.Set("x-api-key", rawKey)
	}
	rec = httptest.NewRecorder()
	middleware(rec, req)
	return rec, called, fakeDB
}

func assertAPIKeyRejected(t *testing.T, rawKey string, setup func(*middlewareFakeDB, string), wantCode int) {
	t.Helper()
	rec, called, _ := runAPIKeyMiddleware(t, rawKey, setup, nil)
	assert.Equal(t, wantCode, rec.Code)
	assert.False(t, called)
}

func assertAPIKeySuccess(t *testing.T, rawKey string, setup func(*middlewareFakeDB, string), handler func(http.ResponseWriter, *http.Request)) *middlewareFakeDB {
	t.Helper()
	rec, called, fakeDB := runAPIKeyMiddleware(t, rawKey, setup, handler)
	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	return fakeDB
}
