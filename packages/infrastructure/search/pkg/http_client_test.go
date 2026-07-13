package pkg

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultHttpClient(t *testing.T) {
	t.Run("Get Success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "test-value", r.Header.Get("X-Test"))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		}))
		defer server.Close()

		client := NewDefaultHttpClient(1 * time.Second)
		body, status, err := client.Get(context.Background(), server.URL, map[string]string{"X-Test": "test-value"})

		require.NoError(t, err)
		assert.Equal(t, 200, status)
		assert.Equal(t, "ok", string(body))
	})

	t.Run("Connection Error", func(t *testing.T) {
		client := NewDefaultHttpClient(1 * time.Second)
		// Non-existent local port
		_, _, err := client.Get(context.Background(), "http://localhost:1", nil)
		assert.Error(t, err)
	})

	t.Run("Invalid URL", func(t *testing.T) {
		client := NewDefaultHttpClient(1 * time.Second)
		// Invalid URL should cause NewRequestWithContext to fail
		_, _, err := client.Get(context.Background(), "://invalid", nil)
		assert.Error(t, err)
	})

	t.Run("Read Body Error", func(t *testing.T) {
		client := &DefaultHttpClient{
			client: &http.Client{
				Transport: &errorBodyTransport{},
			},
		}
		_, _, err := client.Get(context.Background(), "http://localhost", nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "read error")
	})

	t.Run("Response Too Large", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(strings.Repeat("x", maxHTTPResponseBytes+1)))
		}))
		defer server.Close()

		client := NewDefaultHttpClient(1 * time.Second)
		body, status, err := client.Get(context.Background(), server.URL, nil)

		require.Error(t, err)
		assert.Nil(t, body)
		assert.Equal(t, 200, status)
		assert.Contains(t, err.Error(), "response body exceeds")
	})
}

// errorBodyTransport returns a response with a body that errors on read
type errorBodyTransport struct{}

func (t *errorBodyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: 200,
		Body:       &errorReader{},
	}, nil
}

// errorReader is an io.ReadCloser that always returns an error
type errorReader struct{}

func (r *errorReader) Read(p []byte) (n int, err error) {
	return 0, errors.New("read error")
}

func (r *errorReader) Close() error {
	return nil
}
