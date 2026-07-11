package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJSON(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		data     any
		expected string
	}{
		{
			name:     "simple map",
			status:   http.StatusOK,
			data:     map[string]string{"message": "hello"},
			expected: `{"message":"hello"}`,
		},
		{
			name:     "struct",
			status:   http.StatusCreated,
			data:     struct{ Name string }{Name: "test"},
			expected: `{"Name":"test"}`,
		},
		{
			name:     "array",
			status:   http.StatusOK,
			data:     []string{"a", "b", "c"},
			expected: `["a","b","c"]`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			JSON(w, tc.status, tc.data)

			if w.Code != tc.status {
				t.Errorf("Expected status %d, got %d", tc.status, w.Code)
			}

			contentType := w.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("Expected Content-Type application/json, got %s", contentType)
			}

			// Compare JSON ignoring whitespace
			var gotData, expectedData any
			if err := json.Unmarshal(w.Body.Bytes(), &gotData); err != nil {
				t.Fatalf("Failed to parse response JSON: %v", err)
			}
			if err := json.Unmarshal([]byte(tc.expected), &expectedData); err != nil {
				t.Fatalf("Failed to parse expected JSON: %v", err)
			}

			gotBytes, _ := json.Marshal(gotData)
			expBytes, _ := json.Marshal(expectedData)
			if string(gotBytes) != string(expBytes) {
				t.Errorf("Expected JSON %s, got %s", tc.expected, w.Body.String())
			}
		})
	}
}

func TestJSONMarshalFailure(t *testing.T) {
	w := httptest.NewRecorder()
	JSON(w, http.StatusOK, map[string]any{"bad": make(chan int)})

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("Expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}
	if w.Header().Get("Content-Type") == "application/json" {
		t.Fatalf("expected fallback error response to avoid JSON content type")
	}
	if w.Body.String() != "{\"error\":\"response encoding failed\"}\n" {
		t.Fatalf("unexpected body: %q", w.Body.String())
	}
}

func TestJSONError(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		message string
	}{
		{
			name:    "bad request",
			status:  http.StatusBadRequest,
			message: "Invalid input",
		},
		{
			name:    "unauthorized",
			status:  http.StatusUnauthorized,
			message: "Unauthorized",
		},
		{
			name:    "internal error",
			status:  http.StatusInternalServerError,
			message: "Something went wrong",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			JSONError(w, tc.status, tc.message)

			if w.Code != tc.status {
				t.Errorf("Expected status %d, got %d", tc.status, w.Code)
			}

			var response map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatalf("Failed to parse response: %v", err)
			}

			if response["detail"] != tc.message {
				t.Errorf("Expected detail %q, got %q", tc.message, response["detail"])
			}
			if status, ok := response["status"].(float64); ok {
				if int(status) != tc.status {
					t.Errorf("Expected status %d, got %v", tc.status, response["status"])
				}
			} else {
				t.Errorf("status field missing or not a number: %v", response["status"])
			}
		})
	}
}

func TestJSONErrorWithDetails(t *testing.T) {
	w := httptest.NewRecorder()
	JSONErrorWithDetails(w, http.StatusBadRequest, "Validation failed", "Field 'email' is required")

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["detail"] != "Validation failed" {
		t.Errorf("Expected detail 'Validation failed', got %q", response["detail"])
	}
	if response["instance"] != "Field 'email' is required" {
		t.Errorf("Expected instance 'Field 'email' is required', got %q", response["instance"])
	}
}

func TestJSONErrorWithCode(t *testing.T) {
	w := httptest.NewRecorder()
	JSONErrorWithCode(w, http.StatusConflict, "ALREADY_EXISTS", "User already exists")

	if w.Code != http.StatusConflict {
		t.Errorf("Expected status %d, got %d", http.StatusConflict, w.Code)
	}

	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["detail"] != "User already exists" {
		t.Errorf("Expected detail 'User already exists', got %q", response["detail"])
	}
	if response["code"] != "ALREADY_EXISTS" {
		t.Errorf("Expected code 'ALREADY_EXISTS', got %q", response["code"])
	}
}

func TestErrorResponse_Struct(t *testing.T) {
	resp := ErrorResponse{
		Status:   http.StatusBadRequest,
		Detail:   "Something failed",
		Instance: "More info here",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var parsed ErrorResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if parsed.Status != resp.Status {
		t.Errorf("Status mismatch: %d != %d", parsed.Status, resp.Status)
	}
	if parsed.Detail != resp.Detail {
		t.Errorf("Detail mismatch: %q != %q", parsed.Detail, resp.Detail)
	}
	if parsed.Instance != resp.Instance {
		t.Errorf("Instance mismatch: %q != %q", parsed.Instance, resp.Instance)
	}
}

func TestSuccessResponse_Struct(t *testing.T) {
	resp := SuccessResponse{
		Success: true,
		Message: "Operation completed",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var parsed SuccessResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if parsed.Success != resp.Success {
		t.Errorf("Success mismatch: %v != %v", parsed.Success, resp.Success)
	}
	if parsed.Message != resp.Message {
		t.Errorf("Message mismatch: %q != %q", parsed.Message, resp.Message)
	}
}

func TestSuccessResponse_OmitsEmptyMessage(t *testing.T) {
	resp := SuccessResponse{
		Success: true,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// Should not contain "message" key when empty
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if _, exists := raw["message"]; exists {
		t.Error("Expected 'message' to be omitted when empty")
	}
}

func TestErrorResponse_OmitsEmptyInstance(t *testing.T) {
	resp := ErrorResponse{
		Status: http.StatusBadRequest,
		Detail: "Something failed",
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if _, exists := raw["instance"]; exists {
		t.Error("Expected 'instance' to be omitted when empty")
	}
}
