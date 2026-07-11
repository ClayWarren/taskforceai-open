package orchestrator

import (
	"context"
	"fmt"
	"time"

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

type MockCache struct {
	data map[string]string
}

func (m *MockCache) Get(ctx context.Context, key string) (string, error) {
	val, ok := m.data[key]
	if !ok {
		return "", fmt.Errorf("not found")
	}
	return val, nil
}

func (m *MockCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	if m.data == nil {
		m.data = make(map[string]string)
	}
	m.data[key] = value
	return nil
}

func (m *MockCache) Delete(ctx context.Context, key string) (bool, error) {
	_, ok := m.data[key]
	delete(m.data, key)
	return ok, nil
}

func (m *MockCache) Take(ctx context.Context, key string) (string, error) {
	val, err := m.Get(ctx, key)
	if err == nil {
		_, _ = m.Delete(ctx, key)
	}
	return val, err
}

func (m *MockCache) Clear(ctx context.Context) error {
	m.data = make(map[string]string)
	return nil
}

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
