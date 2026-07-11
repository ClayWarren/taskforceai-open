package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestAllowedOrigins_Default(t *testing.T) {
	// Clear any env var
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	origins := AllowedOrigins()
	if len(origins) != 12 {
		t.Errorf("Expected 12 default origins, got %d", len(origins))
	}

	expected := []string{
		"https://taskforceai.chat",
		"https://www.taskforceai.chat",
		"https://auth.taskforceai.chat",
		"https://api.taskforceai.chat",
		"https://console.taskforceai.chat",
		"https://admin.taskforceai.chat",
		"https://status.taskforceai.chat",
		"https://docs.taskforceai.chat",
		"https://developer.taskforceai.chat",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://localhost:5173",
	}
	for i, o := range expected {
		if origins[i] != o {
			t.Errorf("Expected origin %d to be %s, got %s", i, o, origins[i])
		}
	}
}

func TestAllowedOrigins_ProductionDefaultsExcludeLocalhost(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")
	t.Setenv("VERCEL", "1")

	origins := AllowedOrigins()
	if len(origins) != 9 {
		t.Errorf("Expected 9 production default origins, got %d", len(origins))
	}
	for _, origin := range origins {
		if strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
			t.Fatalf("production defaults should not include local origin %q", origin)
		}
	}
}

func TestAllowedOrigins_Custom(t *testing.T) {
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", "https://example.com,https://test.com")
	defer func() { _ = os.Unsetenv("CORS_ALLOWED_ORIGINS") }()

	origins := AllowedOrigins()
	if len(origins) != 2 {
		t.Errorf("Expected 2 custom origins, got %d", len(origins))
	}
	if origins[0] != "https://example.com" {
		t.Errorf("Expected first origin to be https://example.com, got %s", origins[0])
	}
	if origins[1] != "https://test.com" {
		t.Errorf("Expected second origin to be https://test.com, got %s", origins[1])
	}
}

func TestIsAllowedOrigin(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	tests := []struct {
		origin  string
		allowed bool
	}{
		{"https://taskforceai.chat", true},
		{"https://www.taskforceai.chat", true},
		{"https://console.taskforceai.chat", true},
		{"http://localhost:3000", true},
		{"http://127.0.0.1:3000", true},
		{"http://localhost:5173", true},
		{"https://evil.com", false},
		{"http://localhost:8080", false},
		{"", false},
	}

	for _, tc := range tests {
		result := isAllowedOrigin(tc.origin)
		if result != tc.allowed {
			t.Errorf("isAllowedOrigin(%q) = %v, want %v", tc.origin, result, tc.allowed)
		}
	}
}

func TestIsAllowedOrigin_ProductionLocalhostBlockedByDefault(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")
	t.Setenv("VERCEL", "1")

	if isAllowedOrigin("http://localhost:3000") {
		t.Fatal("localhost should not be allowed by default in production")
	}
}

func TestSetCORSHeaders(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	tests := []struct {
		name              string
		origin            string
		expectOrigin      bool
		expectCredentials bool
	}{
		{
			name:              "allowed origin",
			origin:            "https://taskforceai.chat",
			expectOrigin:      true,
			expectCredentials: true,
		},
		{
			name:              "disallowed origin",
			origin:            "https://evil.com",
			expectOrigin:      false,
			expectCredentials: false,
		},
		{
			name:              "no origin",
			origin:            "",
			expectOrigin:      false,
			expectCredentials: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()

			SetCORSHeaders(w, req)

			// Check origin header
			gotOrigin := w.Header().Get("Access-Control-Allow-Origin")
			if tc.expectOrigin {
				if gotOrigin != tc.origin {
					t.Errorf("Expected origin %s, got %s", tc.origin, gotOrigin)
				}
			} else {
				if gotOrigin != "" {
					t.Errorf("Expected no origin header, got %s", gotOrigin)
				}
			}

			// Check credentials
			gotCreds := w.Header().Get("Access-Control-Allow-Credentials")
			if tc.expectCredentials {
				if gotCreds != "true" {
					t.Errorf("Expected credentials true, got %s", gotCreds)
				}
			}

			// Check common headers are always set
			if w.Header().Get("Access-Control-Allow-Methods") == "" {
				t.Error("Expected Allow-Methods header to be set")
			}
			if w.Header().Get("Access-Control-Allow-Headers") == "" {
				t.Error("Expected Allow-Headers header to be set")
			}
			if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "X-CSRF-Token") {
				t.Error("Expected Allow-Headers to include X-CSRF-Token")
			}
			for _, header := range []string{"X-Org-ID", "X-Sync-Id", "x-api-key", "X-API-Key"} {
				if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), header) {
					t.Errorf("Expected Allow-Headers to include %s", header)
				}
			}
			if w.Header().Get("Access-Control-Max-Age") != "86400" {
				t.Error("Expected Max-Age to be 86400")
			}
			if !strings.Contains(strings.ToLower(w.Header().Get("Vary")), "origin") {
				t.Error("Expected Vary header to include Origin")
			}
		})
	}
}

func TestHandleCORS_Preflight(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "https://taskforceai.chat")
	w := httptest.NewRecorder()

	handled := HandleCORS(w, req)

	if !handled {
		t.Error("Expected preflight request to be handled")
	}
	if w.Code != http.StatusNoContent {
		t.Errorf("Expected status %d, got %d", http.StatusNoContent, w.Code)
	}
}

func TestHandleCORS_NonPreflight(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://taskforceai.chat")
	w := httptest.NewRecorder()

	handled := HandleCORS(w, req)

	if handled {
		t.Error("Expected non-preflight request to not be handled")
	}
	// Headers should still be set
	if w.Header().Get("Access-Control-Allow-Origin") != "https://taskforceai.chat" {
		t.Error("Expected origin header to be set")
	}
}

func TestWithCORS(t *testing.T) {
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	handlerCalled := false
	inner := func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}

	wrapped := WithCORS(inner)

	t.Run("preflight returns early", func(t *testing.T) {
		handlerCalled = false
		req := httptest.NewRequest(http.MethodOptions, "/", nil)
		req.Header.Set("Origin", "https://taskforceai.chat")
		w := httptest.NewRecorder()

		wrapped(w, req)

		if handlerCalled {
			t.Error("Expected inner handler to not be called for preflight")
		}
		if w.Code != http.StatusNoContent {
			t.Errorf("Expected status %d, got %d", http.StatusNoContent, w.Code)
		}
	})

	t.Run("non-preflight calls handler", func(t *testing.T) {
		handlerCalled = false
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Origin", "https://taskforceai.chat")
		w := httptest.NewRecorder()

		wrapped(w, req)

		if !handlerCalled {
			t.Error("Expected inner handler to be called")
		}
		if w.Code != http.StatusOK {
			t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
		}
	})
}

func TestAddVaryHeader_NoDuplicates(t *testing.T) {
	headers := http.Header{}
	addVaryHeader(headers, "Origin")
	addVaryHeader(headers, "origin")

	values := headers.Values("Vary")
	if len(values) != 1 {
		t.Fatalf("expected one Vary header entry, got %d", len(values))
	}
	if strings.TrimSpace(values[0]) != "Origin" {
		t.Fatalf("expected Vary header to be Origin, got %q", values[0])
	}
}
