package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterlogging "github.com/TaskForceAI/adapters/pkg/logging"
)

func TestServeVercelEntrypointRequiresBootstrapPointers(t *testing.T) {
	w := httptest.NewRecorder()
	ServeVercelEntrypoint(w, httptest.NewRequest(http.MethodGet, "/", nil), nil, nil, VercelEntrypointOptions{})

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestServeVercelEntrypointHandlesCORSPreflightBeforeInit(t *testing.T) {
	var mux http.Handler
	var once sync.Once
	initialized := false

	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "https://taskforceai.chat")
	w := httptest.NewRecorder()

	ServeVercelEntrypoint(w, req, &mux, &once, VercelEntrypointOptions{
		InitHandler: func() http.Handler {
			initialized = true
			return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
		},
	})

	if initialized {
		t.Fatal("handler should not initialize for CORS preflight")
	}
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestServeVercelEntrypointBeforeInitCanShortCircuit(t *testing.T) {
	var mux http.Handler
	var once sync.Once
	w := httptest.NewRecorder()

	ServeVercelEntrypoint(w, httptest.NewRequest(http.MethodGet, "/fast", nil), &mux, &once, VercelEntrypointOptions{
		BeforeInit: func(w http.ResponseWriter, _ *http.Request) bool {
			w.WriteHeader(http.StatusAccepted)
			return true
		},
	})

	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusAccepted)
	}
}

func TestServeVercelEntrypointInitializesAndServes(t *testing.T) {
	var mux http.Handler
	var once sync.Once
	initCalls := 0
	extraHeaderCalls := 0

	options := VercelEntrypointOptions{
		InitLogMessage: "initializing unit handler",
		ExtraDebugHeaders: func(w http.ResponseWriter, _ *http.Request) {
			extraHeaderCalls++
			w.Header().Set("X-Extra-Debug", "yes")
		},
		InitHandler: func() http.Handler {
			initCalls++
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(r.URL.Path))
			})
		},
	}

	for range 2 {
		w := httptest.NewRecorder()
		ServeVercelEntrypoint(w, httptest.NewRequest(http.MethodGet, "/served", nil), &mux, &once, options)
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusCreated)
		}
		if w.Header().Get("X-Debug-Path") != "/api/served" || w.Header().Get("X-Extra-Debug") != "yes" {
			t.Fatalf("missing debug headers: %#v", w.Header())
		}
	}

	if initCalls != 1 || extraHeaderCalls != 2 {
		t.Fatalf("initCalls=%d extraHeaderCalls=%d", initCalls, extraHeaderCalls)
	}
}

func TestServeVercelEntrypointFlushesOnVercel(t *testing.T) {
	t.Setenv("VERCEL", "1")

	var mux http.Handler
	var once sync.Once
	w := httptest.NewRecorder()

	ServeVercelEntrypoint(w, httptest.NewRequest(http.MethodGet, "/served", nil), &mux, &once, VercelEntrypointOptions{
		InitHandler: func() http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
		},
	})

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestServeVercelEntrypointReportsMissingInitializedHandler(t *testing.T) {
	var mux http.Handler
	var once sync.Once
	w := httptest.NewRecorder()

	ServeVercelEntrypoint(w, httptest.NewRequest(http.MethodGet, "/", nil), &mux, &once, VercelEntrypointOptions{})

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusInternalServerError)
	}
}

func TestStatusCaptureResponseWriterFlushForwardsToUnderlyingFlusher(t *testing.T) {
	base := &testFlushRecorder{ResponseRecorder: httptest.NewRecorder()}
	writer := newStatusCaptureResponseWriter(base)

	writer.Flush()

	if !base.flushed {
		t.Fatal("expected Flush to forward to underlying response writer")
	}
}

func TestStatusCaptureResponseWriterUnwrapsForProtocolUpgrades(t *testing.T) {
	base := httptest.NewRecorder()
	writer := newStatusCaptureResponseWriter(base)
	if writer.Unwrap() != base {
		t.Fatal("status writer did not unwrap to the platform response writer")
	}
}

func TestStatusCaptureResponseWriterWriteAndDuplicateHeader(t *testing.T) {
	base := httptest.NewRecorder()
	writer := newStatusCaptureResponseWriter(base)

	n, err := writer.Write([]byte("body"))
	if err != nil || n != len("body") {
		t.Fatalf("write = %d, %v", n, err)
	}
	writer.WriteHeader(http.StatusTeapot)
	if writer.statusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", writer.statusCode, http.StatusOK)
	}
}

func TestStatusCaptureResponseWriterFlushWithoutFlusher(t *testing.T) {
	writer := newStatusCaptureResponseWriter(noFlushResponseWriter{HeaderMap: http.Header{}})
	writer.Flush()
}

func TestLogVercelRequestBranches(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/unit?__path=unit", nil)
	req.Header.Set("X-Matched-Path", "/api/unit")
	req.RemoteAddr = "198.51.100.1:1234"
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, &auth.AuthenticatedUser{ID: 42}))
	req = req.WithContext(context.WithValue(req.Context(), OrgIDContextKey, 7))
	req = req.WithContext(adapterlogging.WithLogContext(req.Context(), adapterlogging.LogContextValue{CorrelationID: "corr-123"}))

	for _, status := range []int{http.StatusInternalServerError, http.StatusNotFound, http.StatusOK} {
		w := &statusCaptureResponseWriter{ResponseWriter: httptest.NewRecorder(), statusCode: status}
		logVercelRequest(req, VercelEntrypointOptions{}, w, nowMinusMillisecond())
	}
}

type noFlushResponseWriter struct {
	HeaderMap http.Header
}

func (w noFlushResponseWriter) Header() http.Header {
	return w.HeaderMap
}

func (w noFlushResponseWriter) Write(data []byte) (int, error) {
	return len(data), nil
}

func (w noFlushResponseWriter) WriteHeader(int) {}

func nowMinusMillisecond() time.Time {
	return time.Now().Add(-time.Millisecond)
}

type testFlushRecorder struct {
	*httptest.ResponseRecorder
	flushed bool
}

func (r *testFlushRecorder) Flush() {
	r.flushed = true
}
