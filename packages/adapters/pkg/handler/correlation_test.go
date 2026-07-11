package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/logging"
	"github.com/stretchr/testify/assert"
)

func TestWithCorrelationID(t *testing.T) {
	next := WithCorrelationID(func(w http.ResponseWriter, r *http.Request) {
		cid := logging.GetCorrelationID(r.Context())
		assert.NotEmpty(t, cid)
		assert.Equal(t, cid, w.Header().Get("X-Correlation-ID"))
		w.WriteHeader(http.StatusOK)
	})

	// 1. Generate new ID
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	rec1 := httptest.NewRecorder()
	next(rec1, req1)
	assert.Equal(t, http.StatusOK, rec1.Code)

	// 2. Use existing ID
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("X-Correlation-ID", "my-id")
	rec2 := httptest.NewRecorder()
	next(rec2, req2)
	assert.Equal(t, "my-id", rec2.Header().Get("X-Correlation-ID"))
}
