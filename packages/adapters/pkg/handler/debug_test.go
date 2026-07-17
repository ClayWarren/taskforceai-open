package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDebugEnabledCaseInsensitive(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "TRUE")
	if !DebugEnabled() {
		t.Fatal("debug should be enabled")
	}

	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "false")
	if DebugEnabled() {
		t.Fatal("debug should be disabled")
	}
}

func TestHandleDebug(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		t.Setenv("DEBUG_ENDPOINTS_ENABLED", "")
		w := httptest.NewRecorder()
		HandleDebug(w, httptest.NewRequest(http.MethodGet, "/debug", nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
		}
	})

	t.Run("enabled", func(t *testing.T) {
		t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")
		req := httptest.NewRequest(http.MethodPost, "/debug?x=1", nil)
		w := httptest.NewRecorder()

		HandleDebug(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if body["received_path"] != "/debug" || body["full_url"] != "/debug?x=1" || body["method"] != http.MethodPost {
			t.Fatalf("unexpected debug body: %#v", body)
		}
	})
}
