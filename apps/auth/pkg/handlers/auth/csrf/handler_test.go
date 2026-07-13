package csrf

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCsrfHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/auth/csrf", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Expected Cache-Control no-store, got %q", got)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if body["csrfToken"] == "" {
		t.Error("Expected csrfToken in response, got empty string")
	}

	cookies := resp.Cookies()
	var csrfCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "csrf_token" {
			csrfCookie = c
			break
		}
	}
	if csrfCookie == nil {
		t.Fatal("Expected csrf_token cookie to be set")
	} else {
		if csrfCookie.SameSite != http.SameSiteLaxMode {
			t.Errorf("Expected cookie SameSite to be %v (Lax), got %v", http.SameSiteLaxMode, csrfCookie.SameSite)
		}
		if csrfCookie.HttpOnly {
			t.Error("Expected cookie HttpOnly to be false")
		}
	}
}

func TestCsrfHandler_OPTIONS(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/auth/csrf", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d", w.Result().StatusCode)
	}
}
