package pkg

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockProvider struct {
	mock.Mock
}

func (m *MockProvider) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	args := m.Called(ctx, params)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*agent.ChatCompletion)
	return res, args.Error(1)
}

func (m *MockProvider) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	args := m.Called(ctx, params, onChunk)
	return args.Error(0)
}

func (m *MockProvider) UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error) {
	args := m.Called(ctx, reader, filename, mimeType)
	return args.String(0), args.Error(1)
}

func TestNewRoutingAdapter(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "test")
	cfg := config.Config{}
	ra, err := NewRoutingAdapter(context.Background(), cfg)
	require.NoError(t, err)
	assert.NotNil(t, ra)
	assert.NotNil(t, ra.openai)
	assert.NotNil(t, ra.anthropic)
	assert.NotNil(t, ra.gemini)
}

func TestNewRoutingAdapter_GeminiInitFailureDoesNotFailAdapter(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "")
	cfg := config.Config{}
	ra, err := NewRoutingAdapter(context.Background(), cfg)
	require.NoError(t, err)
	assert.NotNil(t, ra)
	assert.NotNil(t, ra.openai)
	assert.NotNil(t, ra.anthropic)
	assert.Nil(t, ra.gemini)
	assert.Error(t, ra.geminiInitErr)
}

func TestRoutingAdapter_Mocks(t *testing.T) {
	t.Run("Anthropic Routing", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:    oa,
			gemini:    ga,
			anthropic: aa,
		}

		params := agent.ChatCompletionCreateParams{Model: "anthropic/claude"}
		aa.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, _ = ra.CreateChatCompletion(context.Background(), params)
		aa.AssertExpectations(t)
	})

	t.Run("Gemini Routing", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:    oa,
			gemini:    ga,
			anthropic: aa,
		}

		params := agent.ChatCompletionCreateParams{Model: "google/gemini"}
		ga.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, _ = ra.CreateChatCompletion(context.Background(), params)
		ga.AssertExpectations(t)
	})

	t.Run("Gemini Text Routing Uses OpenAI Gateway Adapter", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:                        oa,
			gemini:                        ga,
			anthropic:                     aa,
			routeGeminiTextThroughGateway: true,
		}

		params := agent.ChatCompletionCreateParams{Model: "google/gemini-3.5-flash"}
		oa.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, err := ra.CreateChatCompletion(context.Background(), params)
		require.NoError(t, err)
		oa.AssertExpectations(t)
		ga.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("Gemini Text Streaming Uses OpenAI Gateway Adapter", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:                        oa,
			gemini:                        ga,
			anthropic:                     aa,
			routeGeminiTextThroughGateway: true,
		}

		params := agent.ChatCompletionCreateParams{Model: "google/gemini-3.5-flash"}
		oa.On("CreateChatCompletionStream", mock.Anything, params, mock.Anything).Return(nil)
		err := ra.CreateChatCompletionStream(context.Background(), params, nil)
		require.NoError(t, err)
		oa.AssertExpectations(t)
		ga.AssertNotCalled(t, "CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("Gemini Image Routing Stays Native Gateway Image Adapter", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:                        oa,
			gemini:                        ga,
			anthropic:                     aa,
			routeGeminiTextThroughGateway: true,
		}

		params := agent.ChatCompletionCreateParams{Model: "google/gemini-2.5-flash-image"}
		ga.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, err := ra.CreateChatCompletion(context.Background(), params)
		require.NoError(t, err)
		ga.AssertExpectations(t)
		oa.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("Gemini File Data Routing Stays Native Gemini Adapter", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:                        oa,
			gemini:                        ga,
			anthropic:                     aa,
			routeGeminiTextThroughGateway: true,
		}

		params := agent.ChatCompletionCreateParams{
			Model: "google/gemini-3.5-flash",
			Messages: []agent.ChatCompletionMessage{{
				Role: agent.RoleUser,
				ContentParts: []agent.ContentPart{{
					Type:     agent.ContentPartFileData,
					FileData: &agent.FileDataPart{FileURI: "gemini-file", MimeType: "video/mp4"},
				}},
			}},
		}
		ga.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, err := ra.CreateChatCompletion(context.Background(), params)
		require.NoError(t, err)
		ga.AssertExpectations(t)
		oa.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("OpenAI Routing", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:    oa,
			gemini:    ga,
			anthropic: aa,
		}

		params := agent.ChatCompletionCreateParams{Model: "gpt-4"}
		oa.On("CreateChatCompletion", mock.Anything, params).Return(&agent.ChatCompletion{}, nil)
		_, _ = ra.CreateChatCompletion(context.Background(), params)
		oa.AssertExpectations(t)
	})

	t.Run("Streaming Routing", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:    oa,
			gemini:    ga,
			anthropic: aa,
		}

		params := agent.ChatCompletionCreateParams{Model: "anthropic/claude"}
		aa.On("CreateChatCompletionStream", mock.Anything, params, mock.Anything).Return(nil)
		_ = ra.CreateChatCompletionStream(context.Background(), params, nil)

		params2 := agent.ChatCompletionCreateParams{Model: "google/gemini"}
		ga.On("CreateChatCompletionStream", mock.Anything, params2, mock.Anything).Return(nil)
		_ = ra.CreateChatCompletionStream(context.Background(), params2, nil)

		params3 := agent.ChatCompletionCreateParams{Model: "gpt-4"}
		oa.On("CreateChatCompletionStream", mock.Anything, params3, mock.Anything).Return(nil)
		_ = ra.CreateChatCompletionStream(context.Background(), params3, nil)

		aa.AssertExpectations(t)
		ga.AssertExpectations(t)
		oa.AssertExpectations(t)
	})

	t.Run("UploadFile Routing Uses DefaultModel", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:       oa,
			gemini:       ga,
			anthropic:    aa,
			defaultModel: "openai/gpt-5.6-sol",
		}

		oa.On(
			"UploadFile",
			mock.MatchedBy(func(ctx context.Context) bool {
				return uploadModelFromContext(ctx) == "openai/gpt-5.6-sol"
			}),
			mock.Anything,
			"test.txt",
			"text/plain",
		).Return("file-123", nil)
		uri, err := ra.UploadFile(context.Background(), strings.NewReader("test"), "test.txt", "text/plain")
		require.NoError(t, err)
		assert.Equal(t, "file-123", uri)
		oa.AssertExpectations(t)
		ga.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("WithUploadModel stores model in context", func(t *testing.T) {
		ctx := WithUploadModel(context.Background(), "google/gemini-3.1-pro-preview")
		assert.Equal(t, "google/gemini-3.1-pro-preview", uploadModelFromContext(ctx))
	})

	t.Run("WithUploadModel handles nil context and trims model", func(t *testing.T) {
		ctx := WithUploadModel(nilContext(), "  google/gemini-3.1-pro-preview  ")
		assert.Equal(t, "google/gemini-3.1-pro-preview", uploadModelFromContext(ctx))
		assert.Empty(t, uploadModelFromContext(nilContext()))
	})

	t.Run("UploadFile Routing Can Be Overridden Via Context", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:       oa,
			gemini:       ga,
			anthropic:    aa,
			defaultModel: "openai/gpt-5.6-sol",
		}

		ga.On("UploadFile", mock.Anything, mock.Anything, "test.txt", "text/plain").Return("gs://uri", nil)
		ctx := WithUploadModel(context.Background(), "google/gemini-3.1-pro-preview")
		uri, err := ra.UploadFile(ctx, strings.NewReader("test"), "test.txt", "text/plain")
		require.NoError(t, err)
		assert.Equal(t, "gs://uri", uri)
		ga.AssertExpectations(t)
		oa.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("UploadFile Routing Anthropic Returns Error", func(t *testing.T) {
		oa := new(MockProvider)
		ga := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:       oa,
			gemini:       ga,
			anthropic:    aa,
			defaultModel: "anthropic/claude-fable-5",
		}

		_, err := ra.UploadFile(context.Background(), strings.NewReader("test"), "test.txt", "text/plain")
		assert.ErrorContains(t, err, "does not support native file upload")
	})

	t.Run("Gemini Routing Returns Init Error When Unavailable", func(t *testing.T) {
		oa := new(MockProvider)
		aa := new(MockProvider)
		ra := &RoutingAdapter{
			openai:        oa,
			anthropic:     aa,
			defaultModel:  "google/gemini-3.1-pro-preview",
			geminiInitErr: assert.AnError,
		}

		_, err := ra.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-3.1-pro-preview"})
		require.ErrorContains(t, err, "gemini provider unavailable")
		require.ErrorContains(t, err, assert.AnError.Error())

		err = ra.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "google/gemini-3.1-pro-preview"}, nil)
		require.ErrorContains(t, err, "gemini provider unavailable")

		_, err = ra.UploadFile(context.Background(), strings.NewReader("test"), "test.txt", "text/plain")
		assert.ErrorContains(t, err, "gemini provider unavailable")
	})

	t.Run("Gemini Unavailable Error Omits Init Error When Missing", func(t *testing.T) {
		ra := &RoutingAdapter{}
		assert.EqualError(t, ra.geminiUnavailableError(), "gemini provider unavailable")
	})
}

func nilContext() context.Context {
	return nil
}
