package taskforceai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("network unavailable")
}

type transientFailingTransport struct {
	attempts atomic.Int32
}

func (t *transientFailingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	if t.attempts.Add(1) == 1 {
		return nil, errors.New("temporary network failure")
	}
	return sdkTestResponse(http.StatusOK, ""), nil
}

func clientForServer(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	return client
}

func sdkTestResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

type sdkClientCall struct {
	name string
	run  func(*Client) error
}

func assertRequestFailureModes(t *testing.T, calls []sdkClientCall) {
	t.Helper()
	for _, call := range calls {
		t.Run(call.name+"/error", func(t *testing.T) {
			boom := errors.New("request failed")
			client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
			client.requestHook = func(context.Context, string, string, any) (*http.Response, error) {
				return nil, boom
			}

			if err := call.run(client); !errors.Is(err, boom) {
				t.Fatalf("expected request error, got %v", err)
			}
		})

		t.Run(call.name+"/nil-response", func(t *testing.T) {
			client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
			client.requestHook = func(context.Context, string, string, any) (*http.Response, error) {
				return nil, nil
			}

			if err := call.run(client); err == nil || !strings.Contains(err.Error(), "response unavailable") {
				t.Fatalf("expected nil response error, got %v", err)
			}
		})
	}
}

func contextWithTraceParent(t *testing.T) context.Context {
	t.Helper()

	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTextMapPropagator(previousPropagator)
	})

	traceID, err := trace.TraceIDFromHex("00000000000000000000000000000001")
	if err != nil {
		t.Fatalf("parse trace ID: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("0000000000000001")
	if err != nil {
		t.Fatalf("parse span ID: %v", err)
	}
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})

	return trace.ContextWithSpanContext(context.Background(), spanContext)
}

func TestNewClient_Defaults(t *testing.T) {
	client, err := NewClient(TaskForceAIOptions{APIKey: "key"})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	if client.baseURL != DefaultBaseURL {
		t.Errorf("expected default base URL, got %s", client.baseURL)
	}
	if client.timeout != DefaultTimeout {
		t.Errorf("expected default timeout, got %v", client.timeout)
	}
}

func TestNewClient_EmptyAPIKey(t *testing.T) {
	_, err := NewClient(TaskForceAIOptions{})
	if err == nil {
		t.Error("expected error for empty API key, got nil")
	}

	// Mock mode should allow empty API key
	client, err := NewClient(TaskForceAIOptions{MockMode: true})
	if err != nil {
		t.Fatalf("NewClient with mock mode failed: %v", err)
	}
	if client == nil {
		t.Error("expected client, got nil")
	}
}

func TestStripAPIKeyOnCrossHostRedirect(t *testing.T) {
	originURL, _ := url.Parse("https://api.taskforceai.chat/run")
	sameHostURL, _ := url.Parse("https://api.taskforceai.chat/redirected")
	crossHostURL, _ := url.Parse("https://files.example/download")

	origin := &http.Request{URL: originURL, Header: http.Header{}}
	sameHost := &http.Request{URL: sameHostURL, Header: http.Header{}}
	crossHost := &http.Request{URL: crossHostURL, Header: http.Header{}}
	origin.Header.Set(apiKeyHeader, "secret")
	sameHost.Header.Set(apiKeyHeader, "secret")
	crossHost.Header.Set(apiKeyHeader, "secret")

	if err := stripAPIKeyOnCrossHostRedirect(sameHost, []*http.Request{origin}); err != nil {
		t.Fatalf("same-host redirect returned error: %v", err)
	}
	if sameHost.Header.Get(apiKeyHeader) != "secret" {
		t.Fatalf("same-host redirect should preserve api key, got %q", sameHost.Header.Get(apiKeyHeader))
	}

	if err := stripAPIKeyOnCrossHostRedirect(crossHost, []*http.Request{origin}); err != nil {
		t.Fatalf("cross-host redirect returned error: %v", err)
	}
	if crossHost.Header.Get(apiKeyHeader) != "" {
		t.Fatalf("cross-host redirect should strip api key, got %q", crossHost.Header.Get(apiKeyHeader))
	}
}

func TestStripAPIKeyOnCrossHostRedirectAllowsInitialRequest(t *testing.T) {
	targetURL, _ := url.Parse("https://api.taskforceai.chat/run")
	target := &http.Request{URL: targetURL, Header: http.Header{}}

	if err := stripAPIKeyOnCrossHostRedirect(target, nil); err != nil {
		t.Fatalf("initial request returned error: %v", err)
	}
}

func TestStripAPIKeyOnCrossHostRedirectStopsAfterMaxHops(t *testing.T) {
	targetURL, _ := url.Parse("https://api.taskforceai.chat/final")
	target := &http.Request{URL: targetURL, Header: http.Header{}}
	via := make([]*http.Request, maxRedirectHops)
	for i := range via {
		via[i] = &http.Request{URL: targetURL}
	}

	if err := stripAPIKeyOnCrossHostRedirect(target, via); !errors.Is(err, errTooManyRedirects) {
		t.Fatalf("expected errTooManyRedirects, got %v", err)
	}
}

func TestClient_doRequestNilInternalResponse(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	client.doRequestInternalHook = func(context.Context, string, string, any) (*http.Response, error) {
		return nil, nil
	}

	resp, err := client.doRequest(context.Background(), "GET", "/", nil)
	if resp != nil {
		_ = resp.Body.Close()
		t.Fatalf("expected nil response, got %#v", resp)
	}
	if err == nil || !strings.Contains(err.Error(), "without a response") {
		t.Fatalf("expected missing response error, got %v", err)
	}
}

func TestClient_doRequest_Errors(t *testing.T) {
	// 1. Marshaling error
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	resp, err := client.doRequestInternal(context.Background(), "POST", "/", make(chan int))
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected marshal error for chan type, got nil")
	}

	// 2. NewRequest error (invalid method)
	resp, err = client.doRequestInternal(context.Background(), "INVALID METHOD", "/", nil)
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected error for invalid HTTP method, got nil")
	}

	// 3. Client.Do error (network error)
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://example.invalid"})
	client.httpClient = &http.Client{Transport: failingTransport{}}
	resp, err = client.doRequestInternal(context.Background(), "GET", "/", nil)
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected network error, got nil")
	}
}

func TestClient_doRequest_AuthHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "secret-key" {
			t.Errorf("expected x-api-key header, got %s", r.Header.Get("x-api-key"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		BaseURL: server.URL,
		APIKey:  "secret-key",
	})
	resp, _ := client.doRequest(context.Background(), "GET", "/", nil)
	if resp != nil {
		_ = resp.Body.Close()
	}
}

func TestClient_doRequest_Hook(t *testing.T) {
	hookCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
		ResponseHook: func(statusCode int, header map[string][]string) {
			hookCalled = true
			if statusCode != http.StatusCreated {
				t.Errorf("expected status 201 in hook, got %d", statusCode)
			}
		},
	})

	resp, _ := client.doRequest(context.Background(), "GET", "/", nil)
	if resp != nil {
		_ = resp.Body.Close()
	}
	if !hookCalled {
		t.Error("expected response hook to be called")
	}
}

func TestClient_doRequest_RetriesOnTransientStatusAndSucceeds(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := attempts.Add(1)
		if current == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	resp, err := client.doRequest(context.Background(), "GET", "/", nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got error: %v", err)
	}
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %#v", resp)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 attempts, got %d", got)
	}
}

func TestClient_doRequest_RetriesAfterTransportError(t *testing.T) {
	transport := &transientFailingTransport{}
	client, err := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "https://api.example.test"})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	client.httpClient = &http.Client{Transport: transport}

	resp, err := client.doRequest(context.Background(), http.MethodGet, "/run", nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if got := transport.attempts.Load(); got != 2 {
		t.Fatalf("expected 2 attempts, got %d", got)
	}
}

func TestClient_doRequest_RetriesOnRateLimitAndSucceeds(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := attempts.Add(1)
		if current == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	resp, err := client.doRequest(context.Background(), "GET", "/", nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got error: %v", err)
	}
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %#v", resp)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 attempts, got %d", got)
	}
}

func TestClient_doRequest_DoesNotRetryPost(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	client := clientForServer(t, server)
	resp, err := client.doRequest(context.Background(), http.MethodPost, "/run", map[string]any{"prompt": "run"})
	if err != nil {
		t.Fatalf("unexpected transport error: %v", err)
	}
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("expected one POST attempt, got %d", got)
	}
}

func TestClient_doRequest_StopsWhenContextCanceledDuringBackoff(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	resp, err := client.doRequest(ctx, "GET", "/", nil)
	if err == nil || !errors.Is(err, context.Canceled) {
		if resp != nil {
			_ = resp.Body.Close()
		}
		t.Fatalf("expected context canceled error, got resp=%v err=%v", resp, err)
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("expected one request before cancellation, got %d", got)
	}
}
