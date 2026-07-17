package handler

import (
	"net/http"
	"os"
	"strings"
)

// IsProductionEnv reports whether the current process is running in a production deployment.
func IsProductionEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production") ||
		strings.TrimSpace(os.Getenv("VERCEL")) != ""
}

// AllowedOrigins returns the list of allowed CORS origins.
func AllowedOrigins() []string {
	origins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if origins == "" {
		// Default allowed origins
		defaults := make([]string, 0, 12)
		defaults = append(defaults,
			"https://taskforceai.chat",
			"https://www.taskforceai.chat",
			"https://auth.taskforceai.chat",
			"https://api.taskforceai.chat",
			"https://console.taskforceai.chat",
			"https://admin.taskforceai.chat",
			"https://status.taskforceai.chat",
			"https://docs.taskforceai.chat",
			"https://developer.taskforceai.chat",
		)
		if IsProductionEnv() {
			return defaults
		}
		return append(defaults,
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:5173",
		)
	}
	return strings.Split(origins, ",")
}

// isAllowedOrigin checks if the origin is in the allowed list.
func isAllowedOrigin(origin string) bool {
	for _, allowed := range AllowedOrigins() {
		if origin == strings.TrimSpace(allowed) {
			return true
		}
	}
	return false
}

// SetCORSHeaders sets CORS headers on the response.
func SetCORSHeaders(w http.ResponseWriter, r *http.Request) {
	addVaryHeader(w.Header(), "Origin")
	origin := r.Header.Get("Origin")
	if origin != "" && isAllowedOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Correlation-ID, X-Request-ID, X-Org-ID, X-Sync-Id, x-api-key, X-API-Key")
	w.Header().Set("Access-Control-Expose-Headers", "X-Correlation-ID")
	w.Header().Set("Access-Control-Max-Age", "86400")
}

// HandleCORS handles CORS preflight and sets headers.
// Returns true if the request was a preflight request (and handled).
func HandleCORS(w http.ResponseWriter, r *http.Request) bool {
	SetCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// WithCORS wraps a handler with CORS support.
func WithCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if HandleCORS(w, r) {
			return
		}
		next(w, r)
	}
}

func addVaryHeader(headers http.Header, value string) {
	for _, current := range headers.Values("Vary") {
		for candidate := range strings.SplitSeq(current, ",") {
			if strings.EqualFold(strings.TrimSpace(candidate), value) {
				return
			}
		}
	}
	headers.Add("Vary", value)
}
