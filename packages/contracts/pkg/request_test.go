package pkg

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestContext(t *testing.T) {
	t.Run("Do - Success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "GET", r.Method)
			assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"ok"}`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, func() string { return "test-token" })
		var resp struct {
			Message string `json:"message"`
		}
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)

		require.NoError(t, err)
		assert.Equal(t, "ok", resp.Message)
	})

	t.Run("Do - Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`not found`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		err := ctx.Do(context.Background(), "GET", "/404", nil, nil)

		require.Error(t, err)
		var apiErr *ApiClientError
		if assert.ErrorAs(t, err, &apiErr) {
			assert.Equal(t, http.StatusNotFound, apiErr.Status)
			assert.Equal(t, "not found", apiErr.Message)
		}
	})

	t.Run("Do - Error Uses JSON Detail Message", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"detail":"theme update rejected"}`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		err := ctx.Do(context.Background(), "GET", "/bad", nil, nil)

		require.Error(t, err)
		var apiErr *ApiClientError
		if assert.ErrorAs(t, err, &apiErr) {
			assert.Equal(t, http.StatusBadRequest, apiErr.Status)
			assert.Equal(t, "theme update rejected", apiErr.Message)
		}
	})

	t.Run("NormalizeBaseURL", func(t *testing.T) {
		u := "http://api.com"
		assert.Equal(t, u, NormalizeBaseURL(u))
	})

	t.Run("NormalizeBaseURL - Trims Trailing Slash", func(t *testing.T) {
		assert.Equal(t, "http://api.com", NormalizeBaseURL("http://api.com/"))
		assert.Equal(t, "http://api.com", NormalizeBaseURL("  http://api.com///  "))
	})

	t.Run("NewRequestContext - Uses Shared Timeout Client", func(t *testing.T) {
		ctx := NewRequestContext("http://api.com", nil)
		assert.NotNil(t, ctx.HTTPClient)
		assert.Equal(t, defaultHTTPClientTimeout, ctx.HTTPClient.Timeout)
	})

	t.Run("Do - POST with Body", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "POST", r.Method)
			assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			assert.Equal(t, "test-value", body["key"])

			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"result":"success"}`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		var resp struct {
			Result string `json:"result"`
		}
		err := ctx.Do(context.Background(), "POST", "/create", map[string]string{"key": "test-value"}, &resp)

		require.NoError(t, err)
		assert.Equal(t, "success", resp.Result)
	})

	t.Run("Do - Empty Token", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Empty(t, r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, func() string { return "" })
		err := ctx.Do(context.Background(), "GET", "/test", nil, nil)
		assert.NoError(t, err)
	})

	t.Run("Do - Nil Response Target", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		err := ctx.Do(context.Background(), "DELETE", "/resource", nil, nil)
		assert.NoError(t, err)
	})

	t.Run("Do - No Content with Structured Target", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		var resp struct {
			Message string `json:"message"`
		}
		err := ctx.Do(context.Background(), "GET", "/empty", nil, &resp)
		require.NoError(t, err)
		assert.Empty(t, resp.Message)
	})

	t.Run("Do - String Target with JSON String", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`"hello"`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		var resp string
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)
		require.NoError(t, err)
		assert.Equal(t, "hello", resp)
	})

	t.Run("Do - String Target with JSON Object", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		var resp string
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)
		require.NoError(t, err)
		assert.JSONEq(t, `{"status":"ok"}`, resp)
	})

	t.Run("Do - String Target with Empty Body", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		resp := "unchanged"
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)
		require.NoError(t, err)
		assert.Empty(t, resp)
	})

	t.Run("Do - Decode Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		var resp struct {
			Message string `json:"message"`
		}
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "decode response body")
	})

	t.Run("Do - Marshal Error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL, nil)
		// Channels cannot be marshaled to JSON
		err := ctx.Do(context.Background(), "POST", "/test", make(chan int), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "chan")
	})

	t.Run("Do - Invalid URL", func(t *testing.T) {
		ctx := NewRequestContext("://invalid-url", nil)
		err := ctx.Do(context.Background(), "GET", "/test", nil, nil)
		assert.Error(t, err)
	})

	t.Run("Do - Invalid Method", func(t *testing.T) {
		ctx := NewRequestContext("http://localhost", nil)
		err := ctx.Do(context.Background(), "INVALID\x00METHOD", "/test", nil, nil)
		assert.Error(t, err)
	})

	t.Run("Do - HTTPClient Error", func(t *testing.T) {
		ctx := &RequestContext{
			BaseURL: "http://localhost",
			HTTPClient: &http.Client{
				Transport: &failingRoundTripper{},
			},
			GetToken: nil,
		}
		err := ctx.Do(context.Background(), "GET", "/test", nil, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "network error")
	})

	t.Run("Do - Error Response Read Failure", func(t *testing.T) {
		ctx := &RequestContext{
			BaseURL: "http://localhost",
			HTTPClient: &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusBadGateway,
						Status:     "502 Bad Gateway",
						Body:       errorReadCloser{readErr: errors.New("read broke")},
					}, nil
				}),
			},
		}

		err := ctx.Do(context.Background(), "GET", "/test", nil, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "read error response body")
	})

	t.Run("Do - Success Response Read Failure", func(t *testing.T) {
		ctx := &RequestContext{
			BaseURL: "http://localhost",
			HTTPClient: &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Status:     "200 OK",
						Body:       errorReadCloser{readErr: errors.New("read broke")},
					}, nil
				}),
			},
		}

		var resp string
		err := ctx.Do(context.Background(), "GET", "/test", nil, &resp)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "read response body")
	})

	t.Run("Do - Close Failure", func(t *testing.T) {
		ctx := &RequestContext{
			BaseURL: "http://localhost",
			HTTPClient: &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusNoContent,
						Status:     "204 No Content",
						Body:       errorReadCloser{closeErr: errors.New("close broke")},
					}, nil
				}),
			},
		}

		err := ctx.Do(context.Background(), "GET", "/test", nil, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "close response body")
	})

	t.Run("Do - Trailing Slash Base URL", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/api/v1/auth/me", r.URL.Path)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"ok"}`))
		}))
		defer server.Close()

		ctx := NewRequestContext(server.URL+"/", nil)
		var resp struct {
			Message string `json:"message"`
		}

		err := ctx.Do(context.Background(), "GET", "/api/v1/auth/me", nil, &resp)
		require.NoError(t, err)
		assert.Equal(t, "ok", resp.Message)
	})
}

// failingRoundTripper is a custom RoundTripper that always returns an error
type failingRoundTripper struct{}

func (f *failingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return nil, errors.New("network error")
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type errorReadCloser struct {
	readErr  error
	closeErr error
}

func (r errorReadCloser) Read(p []byte) (int, error) {
	if r.readErr != nil {
		return 0, r.readErr
	}
	return 0, io.EOF
}

func (r errorReadCloser) Close() error {
	return r.closeErr
}

func TestApiClientError_Error(t *testing.T) {
	err := &ApiClientError{
		Status:  http.StatusTeapot,
		Message: "short and stout",
	}

	assert.Equal(t, "API error (status 418): short and stout", err.Error())
}

func TestBuildDefaultTransportFallback(t *testing.T) {
	originalTransport := http.DefaultTransport
	t.Cleanup(func() {
		http.DefaultTransport = originalTransport
	})

	fallback := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("unused")
	})
	http.DefaultTransport = fallback

	resp, err := buildDefaultTransport().RoundTrip(httptest.NewRequest(http.MethodGet, "http://example.test", nil))
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	require.Error(t, err)
	assert.Equal(t, "unused", err.Error())
}

func TestDeriveAPIErrorMessage(t *testing.T) {
	tests := []struct {
		name           string
		defaultMessage string
		body           string
		want           string
	}{
		{
			name:           "empty body uses default",
			defaultMessage: "404 Not Found",
			body:           "   ",
			want:           "404 Not Found",
		},
		{
			name:           "message key",
			defaultMessage: "400 Bad Request",
			body:           `{"message":"message text"}`,
			want:           "message text",
		},
		{
			name:           "error key",
			defaultMessage: "400 Bad Request",
			body:           `{"error":"error text"}`,
			want:           "error text",
		},
		{
			name:           "nested detail array",
			defaultMessage: "422 Unprocessable Entity",
			body:           `{"detail":[{"message":"nested message"}]}`,
			want:           "nested message",
		},
		{
			name:           "non json body trims text",
			defaultMessage: "500 Internal Server Error",
			body:           "\nplain failure\n",
			want:           "plain failure",
		},
		{
			name:           "json without message falls back to body",
			defaultMessage: "400 Bad Request",
			body:           `{"code":"bad_request"}`,
			want:           `{"code":"bad_request"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveAPIErrorMessage(tt.defaultMessage, []byte(tt.body))
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestExtractAPIErrorMessage(t *testing.T) {
	tests := []struct {
		name  string
		value any
		want  string
	}{
		{
			name:  "string trims whitespace",
			value: "  useful message  ",
			want:  "useful message",
		},
		{
			name: "array uses first nested message",
			value: []any{
				"",
				map[string]any{"detail": "array detail"},
			},
			want: "array detail",
		},
		{
			name: "map checks message detail error order",
			value: map[string]any{
				"message": "",
				"detail":  []any{map[string]any{"error": "nested error"}},
			},
			want: "nested error",
		},
		{
			name:  "unsupported type returns empty",
			value: 42,
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, extractAPIErrorMessage(tt.value))
		})
	}
}
