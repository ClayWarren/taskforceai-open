// Package handler provides shared utilities for HTTP handlers.
package handler

import (
	"encoding/json"
	"net/http"
)

// JSON writes a JSON response with the given status code.
// data is marshalled before writing any headers so that a marshalling failure
// can still return a well-formed 500 instead of a truncated body after the
// status line has already been sent.
func JSON(w http.ResponseWriter, status int, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		http.Error(w, `{"error":"response encoding failed"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

// JSONError writes a JSON error response in Huma format.
func JSONError(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]any{"status": status, "detail": message})
}

// JSONErrorWithDetails writes a JSON error response with details.
func JSONErrorWithDetails(w http.ResponseWriter, status int, message string, details string) {
	JSON(w, status, map[string]any{"status": status, "detail": message, "instance": details})
}

// JSONErrorWithCode writes a JSON error response including a machine-readable code.
func JSONErrorWithCode(w http.ResponseWriter, status int, code string, message string) {
	JSON(w, status, map[string]any{"status": status, "detail": message, "code": code})
}

// ErrorResponse represents a standard Huma-compatible error response.
type ErrorResponse struct {
	Status   int    `json:"status"`
	Title    string `json:"title,omitempty"`
	Detail   string `json:"detail"`
	Code     string `json:"code,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// SuccessResponse represents a standard success response.
type SuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}
