package handler

import (
	"net/http"
	"os"
	"strings"
)

// DebugEnabled returns true if the DEBUG_ENDPOINTS_ENABLED env var is set to "true".
func DebugEnabled() bool {
	return strings.EqualFold(os.Getenv("DEBUG_ENDPOINTS_ENABLED"), "true")
}

// HandleDebug responds with request path and method info when debug is enabled,
// or 404 when disabled.
func HandleDebug(w http.ResponseWriter, r *http.Request) {
	if !DebugEnabled() {
		JSONError(w, http.StatusNotFound, "Not found")
		return
	}
	JSON(w, http.StatusOK, map[string]any{
		"received_path": r.URL.Path,
		"full_url":      r.URL.String(),
		"method":        r.Method,
	})
}
