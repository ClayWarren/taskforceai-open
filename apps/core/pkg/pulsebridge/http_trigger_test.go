package pulsebridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNewHTTPTrigger_Success(t *testing.T) {
	var receivedRequest map[string]any
	var receivedAuth string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("Expected POST, got %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("Expected Content-Type: application/json")
		}
		receivedAuth = r.Header.Get("Authorization")

		if err := json.NewDecoder(r.Body).Decode(&receivedRequest); err != nil {
			t.Errorf("Failed to decode request: %v", err)
		}

		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "test-token")
	err := trigger("agent-123", "heartbeat")

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if receivedRequest["agentId"] != "agent-123" {
		t.Errorf("Expected agentId=agent-123, got %v", receivedRequest["agentId"])
	}
	if receivedRequest["reason"] != "heartbeat" {
		t.Errorf("Expected reason=heartbeat, got %v", receivedRequest["reason"])
	}
	if receivedAuth != "Bearer test-token" {
		t.Errorf("Expected Authorization='Bearer test-token', got %q", receivedAuth)
	}
}

func TestNewHTTPTrigger_NilParentUsesBackground(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(nil, server.URL, "") //nolint:staticcheck // Exercise the documented nil fallback.
	if err := trigger("agent-123", "heartbeat"); err != nil {
		t.Fatalf("nil parent context should use a background context: %v", err)
	}
}

func TestNewHTTPTrigger_NoToken(t *testing.T) {
	var receivedAuth string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	err := trigger("agent-1", "test")

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if receivedAuth != "" {
		t.Errorf("Expected no Authorization header, got %q", receivedAuth)
	}
}

func TestNewHTTPTrigger_DrainsResponseBodyForConnectionReuse(t *testing.T) {
	var newConnections atomic.Int32
	var requests atomic.Int32
	body := strings.Repeat("x", 64*1024)

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, body)
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			newConnections.Add(1)
		}
	}
	server.Start()
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	if err := trigger("agent-1", "heartbeat"); err != nil {
		t.Fatalf("Expected first trigger to succeed, got %v", err)
	}
	if err := trigger("agent-1", "heartbeat"); err != nil {
		t.Fatalf("Expected second trigger to succeed, got %v", err)
	}

	if got := requests.Load(); got != 2 {
		t.Fatalf("Expected 2 requests, got %d", got)
	}
	if got := newConnections.Load(); got != 1 {
		t.Fatalf("Expected response body drain to reuse one connection, got %d new connections", got)
	}
}

func TestNewHTTPTrigger_Non2xxStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	err := trigger("agent-1", "test")

	if err == nil {
		t.Error("Expected error for non-2xx status")
	}
}

func TestNewHTTPTrigger_RetriesRetryableStatusAndSucceeds(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	if err := trigger("agent-1", "test"); err != nil {
		t.Fatalf("Expected retry to succeed, got %v", err)
	}

	if got := calls.Load(); got != 2 {
		t.Fatalf("Expected one retry before success, got %d calls", got)
	}
}

func TestNewHTTPTrigger_CanceledParentContextFailsFast(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(ctx, server.URL, "")
	if err := trigger("agent-1", "test"); err == nil {
		t.Fatal("Expected canceled context error")
	}

	if got := calls.Load(); got != 0 {
		t.Fatalf("Expected canceled parent context to prevent request, got %d calls", got)
	}
}

func TestNewHTTPTrigger_OpensCircuitAfterRetryableFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	for i := range 3 {
		if err := trigger("agent-1", "test"); err == nil {
			t.Fatalf("Expected retryable failure %d", i+1)
		}
	}

	err := trigger("agent-1", "test")
	if err == nil {
		t.Fatal("Expected circuit-open error")
	}
	if !strings.Contains(err.Error(), "circuit open") {
		t.Fatalf("Expected circuit-open error, got %v", err)
	}
}

func TestNewHTTPTrigger_InvalidURL(t *testing.T) {
	trigger := NewHTTPTrigger(context.Background(), "http://invalid-url-that-does-not-exist:99999", "")
	err := trigger("agent-1", "test")

	if err == nil {
		t.Error("Expected error for invalid URL")
	}
}

func TestNewHTTPTrigger_InvalidRequestURL(t *testing.T) {
	trigger := NewHTTPTrigger(context.Background(), "://bad-url", "")
	err := trigger("agent-1", "test")

	if err == nil {
		t.Fatal("Expected error for malformed request URL")
	}
}

func TestSecureJitterEdges(t *testing.T) {
	if got := secureJitter(0); got != 0 {
		t.Fatalf("Expected zero jitter for non-positive max, got %v", got)
	}

	originalSecureJitterInt := secureJitterInt
	t.Cleanup(func() {
		secureJitterInt = originalSecureJitterInt
	})
	secureJitterInt = func(io.Reader, *big.Int) (*big.Int, error) {
		return nil, errors.New("entropy unavailable")
	}
	if got := secureJitter(100); got != 0 {
		t.Fatalf("Expected zero jitter when entropy fails, got %v", got)
	}

	secureJitterInt = func(io.Reader, *big.Int) (*big.Int, error) {
		return big.NewInt(42), nil
	}
	if got := secureJitter(100); got != 42 {
		t.Fatalf("Expected injected jitter 42ns, got %v", got)
	}
}

func TestNewHTTPTrigger_NonRetryableClientErrorDoesNotRetry(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	err := trigger("agent-1", "test")
	if err == nil {
		t.Fatal("Expected error for 400 response")
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("Expected exactly 1 request for non-retryable 4xx, got %d", got)
	}
}

func TestNewHTTPTrigger_NonRetryableClientErrorsDoNotOpenCircuit(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var payload struct {
			AgentID string `json:"agentId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if payload.AgentID == "bad-agent" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")

	for i := range 3 {
		if err := trigger("bad-agent", "heartbeat"); err == nil {
			t.Fatalf("Expected bad-agent request %d to fail", i+1)
		}
	}

	if err := trigger("good-agent", "heartbeat"); err != nil {
		t.Fatalf("Expected good-agent request to succeed, got %v", err)
	}

	if got := calls.Load(); got != 4 {
		t.Fatalf("Expected 4 total requests without retries/circuit-open, got %d", got)
	}
}

func TestNewHTTPTrigger_SuccessResetsCircuitFailures(t *testing.T) {
	var calls atomic.Int32
	success := atomic.Bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if success.Load() {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	trigger := NewHTTPTrigger(context.Background(), server.URL, "")
	if err := trigger("agent-1", "heartbeat"); err == nil {
		t.Fatal("Expected first retryable failure")
	}

	success.Store(true)
	if err := trigger("agent-1", "heartbeat"); err != nil {
		t.Fatalf("Expected success to reset breaker failures, got %v", err)
	}

	success.Store(false)
	for i := range 2 {
		if err := trigger("agent-1", "heartbeat"); err == nil {
			t.Fatalf("Expected retryable failure after reset %d", i+1)
		}
	}

	success.Store(true)
	if err := trigger("agent-1", "heartbeat"); err != nil {
		t.Fatalf("Expected circuit to remain closed after reset, got %v", err)
	}
}
