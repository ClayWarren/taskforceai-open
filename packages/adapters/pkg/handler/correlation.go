package handler

import (
	"net/http"

	"github.com/TaskForceAI/adapters/pkg/logging"
	"github.com/google/uuid"
)

// EnsureCorrelationID extracts or generates a correlation ID, writes it to the
// request/response boundary, and returns a request with the ID in log context.
func EnsureCorrelationID(w http.ResponseWriter, r *http.Request) (*http.Request, string) {
	cid := r.Header.Get(logging.CORRELATION_ID_HEADER)
	if cid == "" {
		cid = r.Header.Get("x-request-id")
	}
	if cid == "" {
		cid = uuid.NewString()
	}

	r.Header.Set(logging.CORRELATION_ID_HEADER, cid)
	if w != nil {
		w.Header().Set("X-Correlation-ID", cid)
	}

	ctx := logging.WithLogContext(r.Context(), logging.LogContextValue{
		CorrelationID: cid,
	})
	return r.WithContext(ctx), cid
}

// WithCorrelationID extracts or generates a correlation ID and injects it into
// the request context and response headers. It checks X-Correlation-ID first,
// then X-Request-ID, and generates a new UUID if neither is present.
func WithCorrelationID(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		nextRequest, _ := EnsureCorrelationID(w, r)
		next(w, nextRequest)
	}
}
