package orchestrator

import (
	"context"
	"fmt"

	"github.com/TaskForceAI/core/internal/testsupport"
	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/mock"
)

type MockLLMClient struct {
	mock.Mock
}

func (m *MockLLMClient) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	args := m.Called(ctx, params)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	completion, ok := args.Get(0).(*agent.ChatCompletion)
	if !ok {
		return nil, fmt.Errorf("unexpected completion type: %T", args.Get(0))
	}
	return completion, args.Error(1)
}

func (m *MockLLMClient) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	args := m.Called(ctx, params, onChunk)
	return args.Error(0)
}

type MockCache = testsupport.MemoryCache

type MockTelemetry struct {
	mock.Mock
}

func (m *MockTelemetry) StartSpan(ctx context.Context, name string, op string, attributes map[string]any, fn func(context.Context) error) error {
	args := m.Called(ctx, name, op, attributes, fn)
	if fn != nil {
		return fn(ctx)
	}
	return args.Error(0)
}

func (m *MockTelemetry) TrackEvent(ctx context.Context, name string, properties map[string]any) {
	m.Called(ctx, name, properties)
}

func (m *MockTelemetry) TrackError(ctx context.Context, err error, properties map[string]any) {
	m.Called(ctx, err, properties)
}

func (m *MockTelemetry) Flush() {
	m.Called()
}
