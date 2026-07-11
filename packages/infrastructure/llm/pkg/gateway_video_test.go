package pkg

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type gatewayVideoErrReader struct{}

func (gatewayVideoErrReader) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func gatewayVideoUserMessage(prompt string) agent.ChatCompletionMessage {
	return agent.ChatCompletionMessage{
		Role: agent.RoleUser,
		ContentParts: []agent.ContentPart{
			{Type: agent.ContentPartText, Text: prompt},
			{
				Type:     agent.ContentPartImageURL,
				ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,QUFB"},
			},
		},
	}
}

func TestGatewayVideoCompletionStream(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/video-model", r.URL.Path)
		assert.Equal(t, "Bearer key", r.Header.Get("Authorization"))
		assert.Equal(t, "0.0.1", r.Header.Get("ai-gateway-protocol-version"))
		assert.Equal(t, "api-key", r.Header.Get("ai-gateway-auth-method"))
		assert.Equal(t, "3", r.Header.Get("ai-video-model-specification-version"))
		assert.Equal(t, "xai/grok-imagine-video-1.5", r.Header.Get("ai-model-id"))

		assert.NoError(t, json.NewDecoder(r.Body).Decode(&requestBody))
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"result","videos":[{"type":"url","url":"https://cdn.example/video.mp4","mediaType":"video/mp4"}]}` + "\n\n"))
	}))
	defer server.Close()

	adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: server.URL}})
	var content strings.Builder
	err := adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{
		Model: coreengine.VideoGenerationModelID,
		Messages: []agent.ChatCompletionMessage{
			gatewayVideoUserMessage("Generate a video of a dog riding a skateboard"),
		},
	}, func(chunk agent.ChatCompletionChunk) {
		if len(chunk.Choices) > 0 {
			content.WriteString(chunk.Choices[0].Delta.Content)
		}
	})

	require.NoError(t, err)
	prompt, ok := requestBody["prompt"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "Generate a video of a dog riding a skateboard", prompt["text"])
	assert.Equal(t, "data:image/png;base64,QUFB", prompt["image"])
	assert.Equal(t, float64(1), requestBody["n"])
	assert.Equal(t, "16:9", requestBody["aspectRatio"])
	assert.Equal(t, "1280x720", requestBody["resolution"])
	assert.Equal(t, float64(10), requestBody["duration"])
	assert.Contains(t, content.String(), "<video controls preload=\"metadata\" playsinline>")
	assert.Contains(t, content.String(), "<source src=\"https://cdn.example/video.mp4\" type=\"video/mp4\">")
	assert.Contains(t, content.String(), "Download generated video")
}

func TestGatewayVideoCompletionSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "custom-value", r.Header.Get("x-custom"))
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"result","videos":[{"type":"url","url":"https://cdn.example/video.mp4"}]}` + "\n\n"))
	}))
	defer server.Close()

	adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{
		APIKey:         "key",
		BaseURL:        server.URL,
		DefaultHeaders: map[string]string{"x-custom": "custom-value"},
	}})
	completion, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
		Model: coreengine.VideoGenerationModelID,
		Messages: []agent.ChatCompletionMessage{
			gatewayVideoUserMessage("Generate a video"),
		},
	})

	require.NoError(t, err)
	require.Len(t, completion.Choices, 1)
	assert.Contains(t, completion.Choices[0].Message.Content, "video/mp4")
}

func TestGatewayVideoDuration(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   int
	}{
		{name: "default", prompt: "Generate a video of a dog", want: 10},
		{name: "hyphenated seconds", prompt: "Generate a 12-second clip of a dog", want: 12},
		{name: "compact seconds", prompt: "Generate a 7s video of a dog", want: 7},
		{name: "spaced seconds", prompt: "Generate a video for 15 seconds", want: 15},
		{name: "clamps high", prompt: "Generate a 30 second video", want: 15},
		{name: "clamps low", prompt: "Generate a 0 second video", want: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, gatewayVideoDuration(tt.prompt))
		})
	}
}

func TestGatewayStatusErrorFallbacks(t *testing.T) {
	require.EqualError(t, gatewayStatusError("video generation", http.StatusTeapot, nil), "video generation failed with status 418: I'm a teapot")
	assert.EqualError(t, gatewayStatusError("video generation", http.StatusBadGateway, []byte("upstream down")), "video generation failed with status 502: upstream down")
}

func TestGatewayVideoPromptNoUserMessage(t *testing.T) {
	assert.Empty(t, gatewayVideoPrompt(agent.ChatCompletionCreateParams{
		Messages: []agent.ChatCompletionMessage{{Role: agent.RoleAssistant, Content: "hello"}},
	}))
}

func TestGatewayVideoPromptStartFrame(t *testing.T) {
	params := agent.ChatCompletionCreateParams{
		Messages: []agent.ChatCompletionMessage{
			gatewayVideoUserMessage("Animate this product photo"),
		},
	}

	assert.Equal(t, "Animate this product photo", gatewayVideoPrompt(params))
	assert.Equal(t, "data:image/png;base64,QUFB", gatewayVideoStartFrame(params))
}

func TestGatewayVideoAuth(t *testing.T) {
	t.Setenv("AI_GATEWAY_API_KEY", "env-api-key")
	t.Setenv("VERCEL_OIDC_TOKEN", "env-oidc-token")

	token, method := gatewayVideoAuth(" cfg-key ")
	assert.Equal(t, "cfg-key", token)
	assert.Equal(t, "api-key", method)

	token, method = gatewayVideoAuth("")
	assert.Equal(t, "env-api-key", token)
	assert.Equal(t, "api-key", method)

	t.Setenv("AI_GATEWAY_API_KEY", "")
	token, method = gatewayVideoAuth("")
	assert.Equal(t, "env-oidc-token", token)
	assert.Equal(t, "oidc", method)

	t.Setenv("VERCEL_OIDC_TOKEN", "")
	token, method = gatewayVideoAuth("")
	assert.Empty(t, token)
	assert.Empty(t, method)
}

func TestGatewayVideoCreateFailures(t *testing.T) {
	t.Run("missing prompt", func(t *testing.T) {
		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model: coreengine.VideoGenerationModelID,
		})
		require.ErrorContains(t, err, "no user prompt")
	})

	t.Run("missing credentials", func(t *testing.T) {
		t.Setenv("AI_GATEWAY_API_KEY", "")
		t.Setenv("VERCEL_OIDC_TOKEN", "")
		adapter := NewOpenAIAdapter(config.Config{})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("video")},
		})
		require.ErrorContains(t, err, "AI Gateway credentials are required")
	})

	t.Run("missing start frame", func(t *testing.T) {
		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "video"}},
		})
		require.ErrorContains(t, err, "requires an image attachment")
	})

	t.Run("marshal failure", func(t *testing.T) {
		previous := marshalGatewayVideoRequest
		marshalGatewayVideoRequest = func(any) ([]byte, error) {
			return nil, errors.New("marshal failed")
		}
		t.Cleanup(func() {
			marshalGatewayVideoRequest = previous
		})

		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("video")},
		})
		require.ErrorContains(t, err, "marshal video generation request")
	})

	t.Run("bad endpoint", func(t *testing.T) {
		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: "://bad-url"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("video")},
		})
		require.ErrorContains(t, err, "create video generation request")
	})

	t.Run("transport failure", func(t *testing.T) {
		previous := doGatewayVideoRequest
		doGatewayVideoRequest = func(*http.Request) (*http.Response, error) {
			return nil, errors.New("network failed")
		}
		t.Cleanup(func() {
			doGatewayVideoRequest = previous
		})

		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("video")},
		})
		require.ErrorContains(t, err, "video generation request failed")
	})

	t.Run("status error", func(t *testing.T) {
		previous := doGatewayVideoRequest
		doGatewayVideoRequest = func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusBadGateway,
				Body:       io.NopCloser(strings.NewReader("")),
			}, nil
		}
		t.Cleanup(func() {
			doGatewayVideoRequest = previous
		})

		adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key"}})
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    coreengine.VideoGenerationModelID,
			Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("video")},
		})
		require.ErrorContains(t, err, "video generation failed with status 502: Bad Gateway")
	})
}

func TestGatewayVideoEndpoint(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{name: "empty uses default", want: defaultGatewayVideoGenerationURL},
		{name: "openai base uses default", baseURL: "https://api.openai.com/v1", want: defaultGatewayVideoGenerationURL},
		{name: "base appends video model", baseURL: "https://gateway.example", want: "https://gateway.example/video-model"},
		{name: "v3 ai appends video model", baseURL: "https://gateway.example/v3/ai", want: "https://gateway.example/v3/ai/video-model"},
		{name: "v1 maps to v3 ai video model", baseURL: "https://gateway.example/v1", want: "https://gateway.example/v3/ai/video-model"},
		{name: "full endpoint is preserved", baseURL: "https://gateway.example/v3/ai/video-model", want: "https://gateway.example/v3/ai/video-model"},
		{name: "trailing slash is normalized", baseURL: " https://gateway.example/v3/ai/ ", want: "https://gateway.example/v3/ai/video-model"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, gatewayVideoEndpoint(tt.baseURL))
		})
	}
}

func TestGatewayVideoMarkdown(t *testing.T) {
	t.Run("base64 video", func(t *testing.T) {
		markdown, err := gatewayVideoMarkdown([]gatewayVideoData{{
			Type:      "base64",
			Data:      "QUFB",
			MediaType: "video/webm",
		}})
		require.NoError(t, err)
		assert.Contains(t, markdown, `src="data:video/webm;base64,QUFB"`)
		assert.Contains(t, markdown, `type="video/webm"`)
	})

	t.Run("url defaults media type", func(t *testing.T) {
		markdown, err := gatewayVideoMarkdown([]gatewayVideoData{{
			Type: "url",
			URL:  "https://cdn.example/video.mp4",
		}})
		require.NoError(t, err)
		assert.Contains(t, markdown, `type="video/mp4"`)
	})

	t.Run("url escapes source attributes", func(t *testing.T) {
		markdown, err := gatewayVideoMarkdown([]gatewayVideoData{{
			Type:      "url",
			URL:       `https://cdn.example/video.mp4?name="clip"&x=<tag>`,
			MediaType: `video/mp4" onerror="alert(1)`,
		}})
		require.NoError(t, err)
		assert.Contains(t, markdown, `src="https://cdn.example/video.mp4?name=&#34;clip&#34;&amp;x=&lt;tag&gt;"`)
		assert.Contains(t, markdown, `type="video/mp4&#34; onerror=&#34;alert(1)"`)
		assert.Contains(t, markdown, `[Download generated video](https://cdn.example/video.mp4?name="clip"&x=<tag>)`)
	})

	t.Run("error cases", func(t *testing.T) {
		tests := []struct {
			name   string
			videos []gatewayVideoData
			want   string
		}{
			{name: "none", want: "returned no videos"},
			{name: "empty url", videos: []gatewayVideoData{{Type: "url"}}, want: "empty video URL"},
			{name: "empty base64", videos: []gatewayVideoData{{Type: "base64"}}, want: "empty video data"},
			{name: "unsupported", videos: []gatewayVideoData{{Type: "file"}}, want: `unsupported video type "file"`},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := gatewayVideoMarkdown(tt.videos)
				require.ErrorContains(t, err, tt.want)
			})
		}
	})
}

func TestGatewayVideoCompletionErrorEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"error","message":"plan does not support video","errorType":"invalid_request","statusCode":400,"param":null}` + "\n\n"))
	}))
	defer server.Close()

	adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: server.URL}})
	_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
		Model: coreengine.VideoGenerationModelID,
		Messages: []agent.ChatCompletionMessage{
			gatewayVideoUserMessage("Generate a video"),
		},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "plan does not support video")
}

func TestGatewayVideoCompletionUnexpectedAndInvalidEvents(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{name: "empty error message", body: `data: {"type":"error"}` + "\n\n", want: "video generation failed"},
		{name: "progress without result", body: `data: {"type":"progress"}` + "\n\n", want: "ended without a result"},
		{name: "no videos", body: `data: {"type":"result","videos":[]}` + "\n\n", want: "returned no videos"},
		{name: "malformed event", body: `data: {` + "\n\n", want: "parse video generation event"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: server.URL}})
			_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
				Model:    coreengine.VideoGenerationModelID,
				Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("Generate a video")},
			})
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestGatewayVideoCompletionStreamNilCallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"result","videos":[{"type":"base64","data":"QUFB"}]}` + "\n\n"))
	}))
	defer server.Close()

	adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: server.URL}})
	err := adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{
		Model:    coreengine.VideoGenerationModelID,
		Messages: []agent.ChatCompletionMessage{gatewayVideoUserMessage("Generate a video")},
	}, nil)
	require.NoError(t, err)
}

func TestReadGatewayVideoEventEdges(t *testing.T) {
	t.Run("done then result", func(t *testing.T) {
		event, err := readGatewayVideoEvent(strings.NewReader("\n" + "data:\n\n" + "data: [DONE]\n\n" + `data: {"type":"result"}` + "\n\n"))
		require.NoError(t, err)
		assert.Equal(t, "result", event.Type)
	})

	t.Run("progress before result", func(t *testing.T) {
		event, err := readGatewayVideoEvent(strings.NewReader(`data: {"type":"progress","message":"queued"}` + "\n\n" + `data: {"type":"result"}` + "\n\n"))
		require.NoError(t, err)
		assert.Equal(t, "result", event.Type)
	})

	t.Run("malformed json", func(t *testing.T) {
		_, err := readGatewayVideoEvent(strings.NewReader("data: {\n\n"))
		require.ErrorContains(t, err, "parse video generation event")
	})

	t.Run("empty stream", func(t *testing.T) {
		_, err := readGatewayVideoEvent(strings.NewReader(""))
		require.ErrorContains(t, err, "ended without a result")
	})

	t.Run("non data eof", func(t *testing.T) {
		_, err := readGatewayVideoEvent(strings.NewReader("event: ping"))
		require.ErrorContains(t, err, "ended without a result")
	})

	t.Run("read error", func(t *testing.T) {
		_, err := readGatewayVideoEvent(gatewayVideoErrReader{})
		require.ErrorContains(t, err, "read video generation stream")
	})
}
