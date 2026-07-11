package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/genai"
)

// --- Gemini Tests ---

func TestGeminiAdapter(t *testing.T) {
	mm := new(MockGeminiModels)
	mf := new(MockGeminiFiles)
	adapter := &GeminiAdapter{
		client:                   mm,
		files:                    mf,
		fileProcessingInterval:   time.Millisecond,
		fileProcessingMaxRetries: 2,
		breaker:                  circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isGeminiRetryableError}),
	}

	t.Run("isGeminiRetryableError", func(t *testing.T) {
		assert.True(t, isGeminiRetryableError(fmt.Errorf("quota exceeded")))
		assert.False(t, isGeminiRetryableError(nil))
	})

	t.Run("CreateChatCompletion success", func(t *testing.T) {
		mm.On("GenerateContent", mock.Anything, "gemini-pro", mock.Anything, mock.Anything).Return(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{Text: "hi"}}}}}}, nil).Once()
		res, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"})
		require.NoError(t, err)
		assert.Equal(t, "hi", res.Choices[0].Message.Content)
	})

	t.Run("CreateChatCompletion distinguishes unset and zero temperature", func(t *testing.T) {
		mmTemp := new(MockGeminiModels)
		a := &GeminiAdapter{
			client:  mmTemp,
			breaker: circuitbreaker.New(circuitbreaker.Config{Name: "gemini-temperature", FailureThreshold: 5, IsTransient: isGeminiRetryableError}),
		}
		mmTemp.On("GenerateContent", mock.Anything, "gemini-pro", mock.Anything, mock.MatchedBy(func(cfg *genai.GenerateContentConfig) bool {
			return cfg != nil && cfg.Temperature == nil
		})).Return(&genai.GenerateContentResponse{}, nil).Once()
		zero := 0.0
		mmTemp.On("GenerateContent", mock.Anything, "gemini-pro", mock.Anything, mock.MatchedBy(func(cfg *genai.GenerateContentConfig) bool {
			return cfg != nil && cfg.Temperature != nil && *cfg.Temperature == 0
		})).Return(&genai.GenerateContentResponse{}, nil).Once()

		_, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"})
		require.NoError(t, err)
		_, err = a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro", Temperature: &zero})
		require.NoError(t, err)
	})

	t.Run("CreateChatCompletionStream success", func(t *testing.T) {
		mm.On("GenerateContentStream", mock.Anything, "gemini-pro", mock.Anything, mock.Anything).Return(func(yield func(*genai.GenerateContentResponse, error) bool) {
			yield(&genai.GenerateContentResponse{Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{Text: "hi"}}}}}}, nil)
		}).Once()
		_ = adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"}, func(chunk agent.ChatCompletionChunk) {})
	})

	t.Run("CreateChatCompletionStream loop error", func(t *testing.T) {
		mm.On("GenerateContentStream", mock.Anything, "gemini-pro", mock.Anything, mock.Anything).Return(func(yield func(*genai.GenerateContentResponse, error) bool) {
			yield(nil, fmt.Errorf("fail"))
		}).Once()
		err := adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"}, func(chunk agent.ChatCompletionChunk) {})
		assert.Error(t, err)
	})

	t.Run("CreateChatCompletionStream cancels iterator on chunk timeout", func(t *testing.T) {
		mmTimeout := new(MockGeminiModels)
		ctxCh := make(chan context.Context, 1)
		cancelled := make(chan struct{})
		a := &GeminiAdapter{
			client:             mmTimeout,
			breaker:            circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isGeminiRetryableError}),
			streamChunkTimeout: time.Millisecond,
		}

		mmTimeout.On(
			"GenerateContentStream",
			mock.MatchedBy(func(ctx context.Context) bool {
				select {
				case ctxCh <- ctx:
				default:
				}
				return true
			}),
			"gemini-pro",
			mock.Anything,
			mock.Anything,
		).Return(func(yield func(*genai.GenerateContentResponse, error) bool) {
			select {
			case streamCtx := <-ctxCh:
				<-streamCtx.Done()
				close(cancelled)
			case <-time.After(100 * time.Millisecond):
			}
		}).Once()

		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"}, nil)
		require.Error(t, err)

		select {
		case <-cancelled:
		case <-time.After(100 * time.Millisecond):
			t.Fatal("stream iterator context was not cancelled")
		}
	})

	t.Run("CreateChatCompletionStream preserves tool call indices across chunks", func(t *testing.T) {
		mmStream := new(MockGeminiModels)
		a := &GeminiAdapter{
			client:  mmStream,
			breaker: circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isGeminiRetryableError}),
		}

		mmStream.On("GenerateContentStream", mock.Anything, "gemini-pro", mock.Anything, mock.Anything).Return(func(yield func(*genai.GenerateContentResponse, error) bool) {
			if !yield(&genai.GenerateContentResponse{
				Candidates: []*genai.Candidate{
					{
						Content: &genai.Content{
							Parts: []*genai.Part{
								{FunctionCall: &genai.FunctionCall{ID: "call-1", Name: "first", Args: map[string]any{"a": 1}}},
							},
						},
					},
				},
			}, nil) {
				return
			}
			yield(&genai.GenerateContentResponse{
				Candidates: []*genai.Candidate{
					{
						Content: &genai.Content{
							Parts: []*genai.Part{
								{FunctionCall: &genai.FunctionCall{ID: "call-2", Name: "second", Args: map[string]any{"b": 2}}},
							},
						},
					},
				},
			}, nil)
		}).Once()

		var indices []int
		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-pro"}, func(chunk agent.ChatCompletionChunk) {
			if len(chunk.Choices) == 0 || len(chunk.Choices[0].Delta.ToolCalls) == 0 {
				return
			}
			if chunk.Choices[0].Delta.ToolCalls[0].Index == nil {
				return
			}
			indices = append(indices, *chunk.Choices[0].Delta.ToolCalls[0].Index)
		})
		require.NoError(t, err)
		assert.Equal(t, []int{0, 1}, indices)
	})

	t.Run("generateImage success", func(t *testing.T) {
		mm.On("GenerateContent", mock.Anything, "flash-image", mock.Anything, mock.MatchedBy(func(cfg *genai.GenerateContentConfig) bool {
			return cfg != nil && len(cfg.ResponseModalities) == 2 && cfg.ResponseModalities[0] == "IMAGE"
		})).Return(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{InlineData: &genai.Blob{Data: []byte("AAAA")}}}}}},
		}, nil).Once()
		res, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/flash-image", Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "p"}}})
		require.NoError(t, err)
		assert.Contains(t, res.Choices[0].Message.Content, "data:image/png;base64")
	})

	t.Run("generateImage uses AI Gateway chat completions", func(t *testing.T) {
		var requestBody gatewayImageRequest
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/v1/chat/completions", r.URL.Path)
			assert.Equal(t, "Bearer gateway-key", r.Header.Get("Authorization"))
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&requestBody))
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","images":[{"type":"image_url","image_url":{"url":"data:image/png;base64,QUFB"}}]}}]}`))
		}))
		defer server.Close()

		a := &GeminiAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: server.URL, APIKey: "gateway-key"}},
		}

		res, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    "google/gemini-2.5-flash-image",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "p"}},
		})

		require.NoError(t, err)
		assert.Contains(t, res.Choices[0].Message.Content, "data:image/png;base64")
		assert.Equal(t, "google/gemini-2.5-flash-image-preview", requestBody.Model)
		assert.Equal(t, []string{"text", "image"}, requestBody.Modalities)
	})

	t.Run("generateVideo returns clean gateway error messages", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			assert.Equal(t, "/video-model", r.URL.Path)
			assert.Equal(t, "Bearer gateway-key", r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write([]byte(`{"error":{"message":"Video generation requires a minimum balance of $10.","type":"insufficient_funds"}}`))
		}))
		defer server.Close()

		a := &OpenAIAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: server.URL, APIKey: "gateway-key"}},
		}

		_, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model: "xai/grok-imagine-video-1.5",
			Messages: []agent.ChatCompletionMessage{{
				Role: agent.RoleUser,
				ContentParts: []agent.ContentPart{
					{Type: agent.ContentPartText, Text: "generate a two-second video"},
					{
						Type:     agent.ContentPartImageURL,
						ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,QUFB"},
					},
				},
			}},
		})

		require.ErrorContains(t, err, "video generation failed with status 402: Video generation requires a minimum balance of $10. (insufficient_funds)")
		assert.NotContains(t, err.Error(), `"error"`)
	})

	t.Run("generateImage rejects unsupported MIME type", func(t *testing.T) {
		mm.On("GenerateContent", mock.Anything, "flash-image", mock.Anything, mock.Anything).Return(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{InlineData: &genai.Blob{Data: []byte("AAAA"), MIMEType: "image/svg+xml"}}}}}},
		}, nil).Once()
		_, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/flash-image", Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "p"}}})
		assert.ErrorContains(t, err, "no images were generated")
	})

	t.Run("generateImage allows parameterized safe MIME type", func(t *testing.T) {
		mm.On("GenerateContent", mock.Anything, "flash-image", mock.Anything, mock.Anything).Return(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{InlineData: &genai.Blob{Data: []byte("AAAA"), MIMEType: "image/png; charset=utf-8"}}}}}},
		}, nil).Once()
		res, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/flash-image", Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "p"}}})
		require.NoError(t, err)
		assert.Contains(t, res.Choices[0].Message.Content, "data:image/png;base64")
	})

	t.Run("CreateChatCompletionStream emits generated image as single chunk", func(t *testing.T) {
		mmImageStream := new(MockGeminiModels)
		a := &GeminiAdapter{
			client:  mmImageStream,
			breaker: circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isGeminiRetryableError}),
		}
		mmImageStream.On("GenerateContent", mock.Anything, "flash-image", mock.Anything, mock.Anything).Return(&genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{{InlineData: &genai.Blob{Data: []byte("image-bytes"), MIMEType: "image/webp"}}}}}},
		}, nil).Once()

		var chunks []agent.ChatCompletionChunk
		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{
			Model:    "google/flash-image",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "draw a diagram"}},
		}, func(chunk agent.ChatCompletionChunk) {
			chunks = append(chunks, chunk)
		})

		require.NoError(t, err)
		assert.Len(t, chunks, 1)
		assert.Contains(t, chunks[0].Choices[0].Delta.Content, "data:image/webp;base64")
		mmImageStream.AssertExpectations(t)
	})

	t.Run("UploadFile success/timeout/failed/cancel", func(t *testing.T) {
		// success
		mf.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f1", State: "PROCESSING"}, nil).Once()
		mf.On("Get", mock.Anything, "f1", mock.Anything).Return(&genai.File{Name: "f1", URI: "gs://f1", State: "ACTIVE"}, nil).Once()
		uri, _ := adapter.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.Equal(t, "gs://f1", uri)

		// failed
		mf.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f2", State: "FAILED"}, nil).Once()
		_, err := adapter.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		require.Error(t, err)

		// cancel
		ctx, cancel := context.WithCancel(context.Background())
		mf.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f3", State: "PROCESSING"}, nil).Once()
		cancel()
		_, err = adapter.UploadFile(ctx, strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.Error(t, err)
	})

	t.Run("UploadFile uses gateway HTTP options", func(t *testing.T) {
		mfGateway := new(MockGeminiFiles)
		a := &GeminiAdapter{
			cfg:                      config.Config{Gateway: config.GatewayConfig{BaseURL: "https://gateway.example"}},
			files:                    mfGateway,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}

		hasGatewayUploadConfig := mock.MatchedBy(func(cfg *genai.UploadFileConfig) bool {
			return cfg != nil && cfg.HTTPOptions != nil && cfg.HTTPOptions.BaseURL == "https://gateway.example"
		})
		hasGatewayGetConfig := mock.MatchedBy(func(cfg *genai.GetFileConfig) bool {
			return cfg != nil && cfg.HTTPOptions != nil && cfg.HTTPOptions.BaseURL == "https://gateway.example"
		})

		mfGateway.On("Upload", mock.Anything, mock.Anything, hasGatewayUploadConfig).Return(&genai.File{Name: "f-gateway", State: "PROCESSING"}, nil).Once()
		mfGateway.On("Get", mock.Anything, "f-gateway", hasGatewayGetConfig).Return(&genai.File{Name: "f-gateway", URI: "gs://f-gateway", State: "ACTIVE"}, nil).Once()

		uri, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		require.NoError(t, err)
		assert.Equal(t, "gs://f-gateway", uri)
		mfGateway.AssertExpectations(t)
	})

	t.Run("UploadFile upload error", func(t *testing.T) {
		mfUploadErr := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfUploadErr,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}
		mfUploadErr.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return((*genai.File)(nil), fmt.Errorf("upload failed")).Once()

		_, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.ErrorContains(t, err, "upload failed")
	})

	t.Run("UploadFile copy error from reader", func(t *testing.T) {
		mfCopyErr := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfCopyErr,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}

		_, err := a.UploadFile(context.Background(), &errReader{err: io.ErrUnexpectedEOF}, "v.mp4", "video/mp4")
		require.Error(t, err)
		mfCopyErr.AssertNotCalled(t, "Upload", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("UploadFile status poll get error", func(t *testing.T) {
		mfGetErr := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfGetErr,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}
		mfGetErr.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f-get", State: "PROCESSING"}, nil).Once()
		mfGetErr.On("Get", mock.Anything, "f-get", mock.Anything).Return((*genai.File)(nil), fmt.Errorf("get failed")).Once()

		_, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.ErrorContains(t, err, "get failed")
	})

	t.Run("UploadFile processing timeout", func(t *testing.T) {
		mfTimeout := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfTimeout,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 1,
		}
		mfTimeout.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f-timeout", State: "PROCESSING"}, nil).Once()
		mfTimeout.On("Get", mock.Anything, "f-timeout", mock.Anything).Return(&genai.File{Name: "f-timeout", State: "PROCESSING"}, nil).Once()

		_, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.ErrorContains(t, err, "timed out")
	})

	t.Run("UploadFile processing failed after poll", func(t *testing.T) {
		mfFailed := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfFailed,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}
		mfFailed.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f-failed", State: "PROCESSING"}, nil).Once()
		mfFailed.On("Get", mock.Anything, "f-failed", mock.Anything).Return(&genai.File{Name: "f-failed", State: "FAILED"}, nil).Once()

		_, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.mp4", "video/mp4")
		assert.ErrorContains(t, err, "file processing failed")
	})

	t.Run("UploadFile non-video skips processing wait", func(t *testing.T) {
		mfNonVideo := new(MockGeminiFiles)
		a := &GeminiAdapter{
			files:                    mfNonVideo,
			fileProcessingInterval:   time.Millisecond,
			fileProcessingMaxRetries: 2,
		}
		mfNonVideo.On("Upload", mock.Anything, mock.Anything, mock.Anything).Return(&genai.File{Name: "f-pdf", URI: "gs://f-pdf", State: "PROCESSING"}, nil).Once()

		uri, err := a.UploadFile(context.Background(), strings.NewReader("v"), "v.pdf", "application/pdf")
		require.NoError(t, err)
		assert.Equal(t, "gs://f-pdf", uri)
		mfNonVideo.AssertNotCalled(t, "Get", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("mapMessages variety", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{Role: agent.RoleSystem, ContentParts: []agent.ContentPart{{Type: agent.ContentPartText, Text: "s"}}},
			{Role: agent.RoleAssistant, Content: "a"},
			{Role: agent.RoleUser, ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartText, Text: "t"},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,QUFB"}},
				{Type: agent.ContentPartFileData, FileData: &agent.FileDataPart{FileURI: "gs://f"}},
				{Type: agent.ContentPartInputAudio, InputAudio: &agent.InputAudioPart{Data: "QUFB", Format: "mp3"}},
			}},
		}
		sys, contents := adapter.mapMessages(msgs)
		assert.NotNil(t, sys)
		assert.Len(t, contents, 2)
		assert.Len(t, contents[1].Parts, 4)
	})

	t.Run("mapMessages maps tool result to function response", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{
				Role: agent.RoleAssistant,
				ToolCalls: []agent.ToolCall{
					{ID: "call-1", Function: agent.ToolCallFunction{Name: "search"}},
				},
			},
			{
				Role:    agent.RoleTool,
				ToolID:  "call-1",
				Content: `{"output":"ok"}`,
			},
		}

		_, contents := adapter.mapMessages(msgs)
		assert.Len(t, contents, 2)
		assert.Len(t, contents[1].Parts, 1)
		assert.NotNil(t, contents[1].Parts[0].FunctionResponse)
		assert.Equal(t, "call-1", contents[1].Parts[0].FunctionResponse.ID)
		assert.Equal(t, "search", contents[1].Parts[0].FunctionResponse.Name)
		assert.Equal(t, "ok", contents[1].Parts[0].FunctionResponse.Response["output"])
	})

	t.Run("mapMessages maps tool result fallbacks", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{
				Role:    agent.RoleTool,
				ToolID:  "unknown-call",
				Content: "plain result",
			},
			{
				Role:    agent.RoleTool,
				Content: "",
			},
		}

		_, contents := adapter.mapMessages(msgs)
		assert.Len(t, contents, 2)

		unknown := contents[0].Parts[0].FunctionResponse
		assert.NotNil(t, unknown)
		assert.Equal(t, "unknown-call", unknown.ID)
		assert.Equal(t, "unknown-call", unknown.Name)
		assert.Equal(t, "plain result", unknown.Response["output"])

		empty := contents[1].Parts[0].FunctionResponse
		assert.NotNil(t, empty)
		assert.Empty(t, empty.ID)
		assert.Equal(t, "tool_result", empty.Name)
		assert.Empty(t, empty.Response["output"])
	})

	t.Run("mapContentParts keeps remote image URLs", func(t *testing.T) {
		parts := adapter.mapContentParts(agent.ChatCompletionMessage{
			Role: agent.RoleUser,
			ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartText, Text: "describe this"},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "https://example.com/cat.png?size=large"}},
			},
		})

		assert.Len(t, parts, 2)
		assert.NotNil(t, parts[1].FileData)
		assert.Equal(t, "https://example.com/cat.png?size=large", parts[1].FileData.FileURI)
		assert.Equal(t, "image/png", parts[1].FileData.MIMEType)
	})

	t.Run("inferImageMimeType variants", func(t *testing.T) {
		tests := []struct {
			rawURL string
			want   string
		}{
			{rawURL: "https://example.com/cat.jpg?size=large", want: "image/jpeg"},
			{rawURL: "https://example.com/cat.jpeg", want: "image/jpeg"},
			{rawURL: "https://example.com/cat.webp", want: "image/webp"},
			{rawURL: "https://example.com/cat.gif", want: "image/gif"},
			{rawURL: "https://example.com/cat.bmp", want: "image/bmp"},
			{rawURL: "https://example.com/cat.tiff", want: "image/tiff"},
			{rawURL: "https://example.com/cat.svg", want: "image/svg+xml"},
			{rawURL: "https://example.com/cat.avif", want: "image/avif"},
			{rawURL: "https://example.com/cat.heic", want: "image/heic"},
			{rawURL: "https://example.com/cat.heif", want: "image/heif"},
			{rawURL: "https://example.com/cat", want: "image/jpeg"},
			{rawURL: "%", want: "image/jpeg"},
		}

		for _, tt := range tests {
			t.Run(tt.rawURL, func(t *testing.T) {
				assert.Equal(t, tt.want, inferImageMimeType(tt.rawURL))
			})
		}
	})

	t.Run("toCoreChunk usage and tools", func(t *testing.T) {
		resp := &genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{Content: &genai.Content{Parts: []*genai.Part{
				{Text: "hi"},
				{FunctionCall: &genai.FunctionCall{ID: "c1", Name: "f"}},
			}}}},
			UsageMetadata: &genai.GenerateContentResponseUsageMetadata{TotalTokenCount: 10},
		}
		chunk := adapter.toCoreChunk(resp)
		assert.Equal(t, "hi", chunk.Choices[0].Delta.Content)
		assert.Len(t, chunk.Choices[0].Delta.ToolCalls, 1)
		assert.Equal(t, int64(10), chunk.Usage.TotalTokens)
	})

	t.Run("toCoreChunk function call continuity across parts", func(t *testing.T) {
		resp := &genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{
				{
					Content: &genai.Content{
						Parts: []*genai.Part{
							{FunctionCall: &genai.FunctionCall{ID: "c1", Name: "first", Args: map[string]any{"a": 1}}},
							{Text: "mid"},
							{FunctionCall: &genai.FunctionCall{ID: "c2", Name: "second", Args: map[string]any{"b": true}}},
						},
					},
				},
			},
		}

		chunk := adapter.toCoreChunk(resp)
		assert.Equal(t, "mid", chunk.Choices[0].Delta.Content)
		assert.Len(t, chunk.Choices[0].Delta.ToolCalls, 2)
		assert.Equal(t, 0, *chunk.Choices[0].Delta.ToolCalls[0].Index)
		assert.Equal(t, "first", chunk.Choices[0].Delta.ToolCalls[0].Function.Name)
		assert.Equal(t, 1, *chunk.Choices[0].Delta.ToolCalls[1].Index)
		assert.Equal(t, "second", chunk.Choices[0].Delta.ToolCalls[1].Function.Name)
	})

	t.Run("toCoreCompletion empty candidates", func(t *testing.T) {
		res := adapter.toCoreCompletion(&genai.GenerateContentResponse{})
		assert.Empty(t, res.Choices)
	})

	t.Run("toCoreCompletion preserves function calls", func(t *testing.T) {
		resp := &genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{
				{
					Content: &genai.Content{
						Parts: []*genai.Part{
							{Text: "hi"},
							{FunctionCall: &genai.FunctionCall{ID: "c1", Name: "lookup", Args: map[string]any{"q": "status"}}},
						},
					},
				},
			},
		}

		res := adapter.toCoreCompletion(resp)
		assert.Equal(t, "hi", res.Choices[0].Message.Content)
		assert.Len(t, res.Choices[0].Message.ToolCalls, 1)
		assert.Equal(t, "c1", res.Choices[0].Message.ToolCalls[0].ID)
		assert.Equal(t, "lookup", res.Choices[0].Message.ToolCalls[0].Function.Name)
		assert.JSONEq(t, `{"q":"status"}`, res.Choices[0].Message.ToolCalls[0].Function.Arguments)
	})

	t.Run("mapTools empty", func(t *testing.T) {
		res := adapter.mapTools([]agent.ToolDefinition{})
		assert.Nil(t, res)
		res2 := adapter.mapTools([]agent.ToolDefinition{{Type: "other"}})
		assert.Nil(t, res2)
	})

	t.Run("parseDataURI variants", func(t *testing.T) {
		tests := []struct {
			name     string
			uri      string
			wantMime string
			wantData []byte
		}{
			{
				name:     "non-data fallback",
				uri:      "https://example.com/image.png",
				wantMime: "image/jpeg",
				wantData: []byte("https://example.com/image.png"),
			},
			{
				name:     "malformed data uri fallback",
				uri:      "data:image/png;base64",
				wantMime: "image/jpeg",
				wantData: []byte("data:image/png;base64"),
			},
			{
				name:     "empty mime defaults jpeg",
				uri:      "data:;base64,QUFB",
				wantMime: "image/jpeg",
				wantData: []byte("AAA"),
			},
			{
				name:     "raw base64 no padding",
				uri:      "data:text/plain;base64,SGk",
				wantMime: "text/plain",
				wantData: []byte("Hi"),
			},
			{
				name:     "invalid base64 keeps encoded bytes",
				uri:      "data:image/png;base64,%%%%",
				wantMime: "image/png",
				wantData: []byte("%%%%"),
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				gotMime, gotData := parseDataURI(tt.uri)
				assert.Equal(t, tt.wantMime, gotMime)
				assert.Equal(t, tt.wantData, gotData)
			})
		}
	})
}

// TestOpenAIAdapter_GetClient_ConcurrentAccess is a regression test for TF-0708.
// Before the fix, getClient had no mutex protecting the clients map, causing a
// concurrent map read/write panic when multiple goroutines invoked it simultaneously.
// Run with: go test -race ./...
