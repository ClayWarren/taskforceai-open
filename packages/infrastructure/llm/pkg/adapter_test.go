package pkg

import (
	"context"
	"io"
	"iter"
	"sync/atomic"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthro_option "github.com/anthropics/anthropic-sdk-go/option"
	anthro_ssestream "github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	openai_option "github.com/openai/openai-go/v3/option"
	openai_ssestream "github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/responses"
	"github.com/stretchr/testify/mock"
	"google.golang.org/genai"
)

// --- Mocks ---

type MockOpenAIResponses struct {
	mock.Mock
}

func (m *MockOpenAIResponses) New(ctx context.Context, body responses.ResponseNewParams, opts ...openai_option.RequestOption) (*responses.Response, error) {
	args := m.Called(ctx, body, opts)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*responses.Response)
	return res, args.Error(1)
}

func (m *MockOpenAIResponses) NewStreaming(ctx context.Context, body responses.ResponseNewParams, opts ...openai_option.RequestOption) *openai_ssestream.Stream[responses.ResponseStreamEventUnion] {
	args := m.Called(ctx, body, opts)
	if args.Get(0) == nil {
		return nil
	}
	res, _ := args.Get(0).(*openai_ssestream.Stream[responses.ResponseStreamEventUnion])
	return res
}

type MockAnthropicMessages struct {
	mock.Mock
}

func (m *MockAnthropicMessages) New(ctx context.Context, body anthropic.MessageNewParams, opts ...anthro_option.RequestOption) (*anthropic.Message, error) {
	args := m.Called(ctx, body, opts)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*anthropic.Message)
	return res, args.Error(1)
}

func (m *MockAnthropicMessages) NewStreaming(ctx context.Context, body anthropic.MessageNewParams, opts ...anthro_option.RequestOption) *anthro_ssestream.Stream[anthropic.MessageStreamEventUnion] {
	args := m.Called(ctx, body, opts)
	if args.Get(0) == nil {
		return nil
	}
	res, _ := args.Get(0).(*anthro_ssestream.Stream[anthropic.MessageStreamEventUnion])
	return res
}

type MockGeminiModels struct {
	mock.Mock
}

func (m *MockGeminiModels) GenerateContent(ctx context.Context, modelID string, contents []*genai.Content, config *genai.GenerateContentConfig) (*genai.GenerateContentResponse, error) {
	args := m.Called(ctx, modelID, contents, config)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*genai.GenerateContentResponse)
	return res, args.Error(1)
}

func (m *MockGeminiModels) GenerateContentStream(ctx context.Context, modelID string, contents []*genai.Content, config *genai.GenerateContentConfig) iter.Seq2[*genai.GenerateContentResponse, error] {
	args := m.Called(ctx, modelID, contents, config)
	if val := args.Get(0); val != nil {
		res, _ := val.(func(func(*genai.GenerateContentResponse, error) bool))
		return res
	}
	return nil
}

func (m *MockGeminiModels) GenerateImages(ctx context.Context, modelID string, prompt string, config *genai.GenerateImagesConfig) (*genai.GenerateImagesResponse, error) {
	args := m.Called(ctx, modelID, prompt, config)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*genai.GenerateImagesResponse)
	return res, args.Error(1)
}

type MockGeminiFiles struct {
	mock.Mock
}

func (m *MockGeminiFiles) Upload(ctx context.Context, r io.Reader, config *genai.UploadFileConfig) (*genai.File, error) {
	args := m.Called(ctx, r, config)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*genai.File)
	return res, args.Error(1)
}

func (m *MockGeminiFiles) Get(ctx context.Context, name string, config *genai.GetFileConfig) (*genai.File, error) {
	args := m.Called(ctx, name, config)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, _ := args.Get(0).(*genai.File)
	return res, args.Error(1)
}

type errReader struct {
	err error
}

func (r *errReader) Read(_ []byte) (int, error) {
	return 0, r.err
}

type blockingAnthropicDecoder struct {
	closeCalls atomic.Int32
	unblock    chan struct{}
}

func newBlockingAnthropicDecoder() *blockingAnthropicDecoder {
	return &blockingAnthropicDecoder{
		unblock: make(chan struct{}),
	}
}

func (d *blockingAnthropicDecoder) Event() anthro_ssestream.Event {
	return anthro_ssestream.Event{}
}

func (d *blockingAnthropicDecoder) Next() bool {
	<-d.unblock
	return false
}

func (d *blockingAnthropicDecoder) Close() error {
	if d.closeCalls.Add(1) == 1 {
		close(d.unblock)
	}
	return nil
}

func (d *blockingAnthropicDecoder) Err() error {
	return nil
}

// --- Shared Test Helpers ---
