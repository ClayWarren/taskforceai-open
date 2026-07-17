package pkg

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGatewayImageEndpoint(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{name: "empty uses default", want: defaultGatewayImageGenerationURL},
		{name: "openai base uses default", baseURL: "https://api.openai.com/v1", want: defaultGatewayImageGenerationURL},
		{name: "base appends v1 chat completions", baseURL: "https://gateway.example", want: "https://gateway.example/v1/chat/completions"},
		{name: "v1 appends chat completions", baseURL: "https://gateway.example/v1", want: "https://gateway.example/v1/chat/completions"},
		{name: "full endpoint is preserved", baseURL: "https://gateway.example/v1/chat/completions", want: "https://gateway.example/v1/chat/completions"},
		{name: "trailing slash is normalized", baseURL: " https://gateway.example/ ", want: "https://gateway.example/v1/chat/completions"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, gatewayImageEndpoint(tt.baseURL))
		})
	}
}

func TestGatewayImageModelID(t *testing.T) {
	assert.Equal(t, "google/gemini-2.5-flash-image-preview", gatewayImageModelID("google/gemini-2.5-flash-image"))
	assert.Equal(t, "google/gemini-2.5-flash-image-preview", gatewayImageModelID("gemini-2.5-flash-image"))
	assert.Equal(t, "google/other-image-model", gatewayImageModelID(" google/other-image-model "))
}

func TestGenerateGatewayImageRequiresCredentials(t *testing.T) {
	t.Setenv("AI_GATEWAY_API_KEY", "")
	t.Setenv("VERCEL_OIDC_TOKEN", "")

	adapter := &GeminiAdapter{}
	_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
		Model: "google/gemini-2.5-flash-image",
	}, "draw")

	require.ErrorContains(t, err, "AI Gateway credentials are required")
}

func TestGenerateGatewayImageRejectsUnsafeImageURLs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"images":[{"type":"image_url","image_url":{"url":"http://example.com/image.png"}}]}}]}`))
	}))
	defer server.Close()

	adapter := &GeminiAdapter{
		cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: server.URL, APIKey: "gateway-key"}},
	}
	_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
		Model: "google/gemini-2.5-flash-image",
	}, "draw")

	require.ErrorContains(t, err, "image generation returned no images")
}

func TestGenerateGatewayImageStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"rate limited","type":"rate_limit"}}`))
	}))
	defer server.Close()

	adapter := &GeminiAdapter{
		cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: server.URL, APIKey: "gateway-key"}},
	}
	_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
		Model: "google/gemini-2.5-flash-image",
	}, "draw")

	require.ErrorContains(t, err, "image generation failed with status 429: rate limited (rate_limit)")
}

func TestGenerateGatewayImageRequestFailures(t *testing.T) {
	t.Run("marshal failure", func(t *testing.T) {
		previous := marshalGatewayImageRequest
		marshalGatewayImageRequest = func(any) ([]byte, error) {
			return nil, errors.New("marshal failed")
		}
		t.Cleanup(func() {
			marshalGatewayImageRequest = previous
		})

		adapter := &GeminiAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{APIKey: "gateway-key"}},
		}
		_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
			Model: "google/gemini-2.5-flash-image",
		}, "draw")
		require.ErrorContains(t, err, "marshal image generation request")
	})

	t.Run("bad endpoint", func(t *testing.T) {
		adapter := &GeminiAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: "://bad-url", APIKey: "gateway-key"}},
		}
		_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
			Model: "google/gemini-2.5-flash-image",
		}, "draw")
		require.ErrorContains(t, err, "create image generation request")
	})

	t.Run("transport failure", func(t *testing.T) {
		previous := doGatewayImageRequest
		doGatewayImageRequest = func(*http.Request) (*http.Response, error) {
			return nil, errors.New("network failed")
		}
		t.Cleanup(func() {
			doGatewayImageRequest = previous
		})

		adapter := &GeminiAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{APIKey: "gateway-key"}},
		}
		_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
			Model: "google/gemini-2.5-flash-image",
		}, "draw")
		require.ErrorContains(t, err, "image generation request failed")
	})

	t.Run("invalid response json", func(t *testing.T) {
		previous := doGatewayImageRequest
		doGatewayImageRequest = func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("{")),
			}, nil
		}
		t.Cleanup(func() {
			doGatewayImageRequest = previous
		})

		adapter := &GeminiAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{APIKey: "gateway-key"}},
		}
		_, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
			Model: "google/gemini-2.5-flash-image",
		}, "draw")
		require.ErrorContains(t, err, "parse image generation response")
	})
}

func TestGenerateGatewayImageHeadersAndSkipsInvalidEntries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "custom-value", r.Header.Get("x-custom"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"images":[{"type":"file","image_url":{"url":"https://cdn.example/ignored.png"}},{"type":"image_url","image_url":{"url":" "}},{"type":"image_url","image_url":{"url":"https://cdn.example/image.png"}}]}}]}`))
	}))
	defer server.Close()

	adapter := &GeminiAdapter{
		cfg: config.Config{Gateway: config.GatewayConfig{
			BaseURL:        server.URL,
			APIKey:         "gateway-key",
			DefaultHeaders: map[string]string{"x-custom": "custom-value"},
		}},
	}
	completion, err := adapter.generateGatewayImage(context.Background(), agent.ChatCompletionCreateParams{
		Model: "google/gemini-2.5-flash-image",
	}, "draw")
	require.NoError(t, err)
	require.Len(t, completion.Choices, 1)
	assert.Contains(t, completion.Choices[0].Message.Content, "https://cdn.example/image.png")
}
