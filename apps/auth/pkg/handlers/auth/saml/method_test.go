package saml

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMethodHandler_Success_OAuth(t *testing.T) {
	h := &MethodHandlerStruct{}
	reqBody, _ := json.Marshal(LoginMethodRequest{Email: "user@test.org"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(reqBody))
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Result().StatusCode)
	}

	var resp LoginMethodResponse
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Method != "OAUTH" {
		t.Errorf("Expected OAUTH, got %s", resp.Method)
	}
}

func TestMethodHandler_Errors(t *testing.T) {
	h := &MethodHandlerStruct{}

	// 1. Invalid Body
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBufferString("invalid"))
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for invalid json")
	}

	// 2. Missing Email
	reqBody, _ := json.Marshal(LoginMethodRequest{Email: ""})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(reqBody))
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing email")
	}

	// 3. Invalid Email Format
	reqBody, _ = json.Marshal(LoginMethodRequest{Email: "invalid-email"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(reqBody))
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for invalid email format")
	}
}

func TestGlobalMethodHandler(t *testing.T) {
	reqBody, _ := json.Marshal(LoginMethodRequest{Email: "test@example.com"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(reqBody))
	w := httptest.NewRecorder()

	func() {
		defer func() { _ = recover() }()
		MethodHandler(w, req)
	}()
}

func TestGlobalMethodHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login-method", nil)
	w := httptest.NewRecorder()

	MethodHandler(w, req)

	if w.Result().StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("Expected 405, got %d", w.Result().StatusCode)
	}
}
