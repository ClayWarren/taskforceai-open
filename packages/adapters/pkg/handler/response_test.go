package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJSON(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		data     any
		expected string
	}{
		{"map", http.StatusOK, map[string]string{"message": "hello"}, `{"message":"hello"}`},
		{"struct", http.StatusCreated, struct{ Name string }{"test"}, `{"Name":"test"}`},
		{"array", http.StatusOK, []string{"a", "b", "c"}, `["a","b","c"]`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			JSON(w, tc.status, tc.data)
			assert.Equal(t, tc.status, w.Code)
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
			assert.JSONEq(t, tc.expected, w.Body.String())
		})
	}
}

func TestJSONMarshalFailure(t *testing.T) {
	w := httptest.NewRecorder()
	JSON(w, http.StatusOK, map[string]any{"bad": make(chan int)})

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.NotEqual(t, "application/json", w.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"error":"response encoding failed"}`, w.Body.String())
}

func TestJSONErrors(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		write    func(http.ResponseWriter)
		expected string
	}{
		{"basic", http.StatusUnauthorized, func(w http.ResponseWriter) { JSONError(w, http.StatusUnauthorized, "Unauthorized") }, `{"status":401,"detail":"Unauthorized"}`},
		{"details", http.StatusBadRequest, func(w http.ResponseWriter) {
			JSONErrorWithDetails(w, http.StatusBadRequest, "Validation failed", "email required")
		}, `{"status":400,"detail":"Validation failed","instance":"email required"}`},
		{"code", http.StatusConflict, func(w http.ResponseWriter) {
			JSONErrorWithCode(w, http.StatusConflict, "ALREADY_EXISTS", "User already exists")
		}, `{"status":409,"detail":"User already exists","code":"ALREADY_EXISTS"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.write(w)
			assert.Equal(t, tc.status, w.Code)
			assert.JSONEq(t, tc.expected, w.Body.String())
		})
	}
}

func TestResponseSchemas(t *testing.T) {
	tests := []struct {
		name     string
		response any
		expected string
	}{
		{"error", ErrorResponse{Status: 400, Title: "Bad Request", Detail: "failed", Code: "BAD", Instance: "field"}, `{"status":400,"title":"Bad Request","detail":"failed","code":"BAD","instance":"field"}`},
		{"error optionals omitted", ErrorResponse{Status: 400, Detail: "failed"}, `{"status":400,"detail":"failed"}`},
		{"success", SuccessResponse{Success: true, Message: "completed"}, `{"success":true,"message":"completed"}`},
		{"success message omitted", SuccessResponse{Success: true}, `{"success":true}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.response)
			require.NoError(t, err)
			assert.JSONEq(t, tc.expected, string(data))
		})
	}
}
