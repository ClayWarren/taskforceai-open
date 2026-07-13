package run

import (
	"context"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/mock"
)

type llmClientMock struct {
	mock.Mock
}

func (m *llmClientMock) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	ret := m.Called(ctx, params)
	value := ret.Get(0)
	if value == nil {
		return nil, ret.Error(1)
	}
	completion, ok := value.(*agent.ChatCompletion)
	if !ok {
		return nil, ret.Error(1)
	}
	return completion, ret.Error(1)
}

func (m *llmClientMock) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	return m.Called(ctx, params, onChunk).Error(0)
}

type cacheMock struct {
	mock.Mock
}

func (m *cacheMock) Get(ctx context.Context, key string) (string, error) {
	ret := m.Called(ctx, key)
	return ret.String(0), ret.Error(1)
}

func (m *cacheMock) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	return m.Called(ctx, key, value, ttl).Error(0)
}

func (m *cacheMock) Delete(ctx context.Context, key string) (bool, error) {
	ret := m.Called(ctx, key)
	return ret.Bool(0), ret.Error(1)
}

func (m *cacheMock) Take(ctx context.Context, key string) (string, error) {
	ret := m.Called(ctx, key)
	return ret.String(0), ret.Error(1)
}

func (m *cacheMock) Clear(ctx context.Context) error {
	return m.Called(ctx).Error(0)
}
