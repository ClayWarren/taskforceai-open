package session

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

func TestHandler(t *testing.T) {
	// ... (content updated to use handler instead of handler)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if msg, ok := body["detail"].(string); !ok || msg != "No active session" {
		t.Errorf("Expected detail 'No active session', got %v", body)
	}
}

func TestSessionHandler_WithAuth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	w := httptest.NewRecorder()

	// Mock authenticated user in context
	name := "Test User"
	expiresAt := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	user := &auth.AuthenticatedUser{
		ID:        123,
		Email:     "test@example.com",
		FullName:  &name,
		ExpiresAt: &expiresAt,
	}
	ctx := context.WithValue(req.Context(), handler.UserContextKey, user)
	req = req.WithContext(ctx)

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	userData, ok := body["user"].(map[string]any)
	if !ok {
		t.Fatalf("expected user data to be map[string]any, got %T", body["user"])
	}
	if userData["email"] != "test@example.com" {
		t.Errorf("Expected email test@example.com, got %v", userData["email"])
	}
	if userData["name"] != "Test User" {
		t.Errorf("Expected name Test User, got %v", userData["name"])
	}
	if body["expires"] != expiresAt.Format(time.RFC3339) {
		t.Errorf("Expected expires %s, got %v", expiresAt.Format(time.RFC3339), body["expires"])
	}
}

func TestSessionHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/session", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("Expected status 405, got %d", resp.StatusCode)
	}
}

func TestSessionHandler_CORS(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/auth/session", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d", resp.StatusCode)
	}
}
