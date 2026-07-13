package handler

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/inngest/inngestgo"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
)

const maxInngestBodyBytes int64 = 1 << 20

// InngestSignatureVerifier verifies Inngest signatures for callback requests.
func InngestSignatureVerifier(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isInngestPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		signingKey := strings.TrimSpace(os.Getenv("INNGEST_SIGNING_KEY"))
		if signingKey == "" {
			if handlerutil.IsProductionEnv() {
				handlerutil.JSONError(w, http.StatusServiceUnavailable, "inngest signing key is not configured")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		sig := r.Header.Get("X-Inngest-Signature")
		if sig == "" {
			handlerutil.JSONError(w, http.StatusUnauthorized, "missing inngest signature")
			return
		}
		limitedBody := http.MaxBytesReader(w, r.Body, maxInngestBodyBytes)
		body, err := io.ReadAll(limitedBody)
		// Close the original body before replacing, so any downstream middleware
		// cannot accidentally read the already-consumed stream.
		_ = limitedBody.Close()
		if err != nil {
			if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
				handlerutil.JSONError(w, http.StatusRequestEntityTooLarge, "inngest request body too large")
				return
			}
			handlerutil.JSONError(w, http.StatusBadRequest, "unable to read request body")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))

		valid, _, err := inngestgo.ValidateRequestSignature(r.Context(), sig, signingKey, "", body, false)
		if err != nil || !valid {
			handlerutil.JSONError(w, http.StatusUnauthorized, "invalid inngest signature")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// AuthMiddleware creates a middleware that handles authentication.
func AuthMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isInngestPath(r.URL.Path) || r.URL.Path == "/api/v1/health" || r.URL.Path == "/api/v1/ready" {
				next.ServeHTTP(w, r)
				return
			}
			q, err := GetQueries(r.Context())
			if err != nil || q == nil {
				SetEngineReadiness(false, "database_unavailable")
				handlerutil.JSONError(w, http.StatusServiceUnavailable, "Database unavailable")
				return
			}
			WithFlexibleAuth(q, func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r)
			})(w, r)
		})
	}
}

// WithServiceHeadersAndCORS adds service headers and handles CORS.
func WithServiceHeadersAndCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Taskforce-Service", "engine-service")
		if handlerutil.HandleCORS(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ReadinessMiddleware checks if the engine is ready before serving requests.
func ReadinessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/health" || r.URL.Path == "/api/v1/ready" || isInngestPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		ready, reason := GetEngineReadiness()
		if !ready {
			handlerutil.JSONError(w, http.StatusServiceUnavailable, "Engine dependencies unavailable: "+reason)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isInngestPath(path string) bool {
	return path == "/api/inngest" || strings.HasPrefix(path, "/api/inngest/")
}
