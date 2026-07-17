package orchestrator

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/mock"
)

func testConfig() config.Config {
	return config.Config{
		Orchestrator: config.OrchestratorConfig{
			ParallelAgents: 4,
		},
	}
}

type GapMockCache struct {
	mock.Mock
}

type blockingParallelLLMClient struct {
	started chan struct{}
	release chan struct{}
}

func (c *blockingParallelLLMClient) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	return &agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "combined"}}},
	}, nil
}

func (c *blockingParallelLLMClient) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	c.started <- struct{}{}

	select {
	case <-c.release:
		onChunk(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{Content: "agent answer"},
			}},
		})
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *GapMockCache) Get(ctx context.Context, key string) (string, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Error(1)
}

func (m *GapMockCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	args := m.Called(ctx, key, value, ttl)
	return args.Error(0)
}

func (m *GapMockCache) Delete(ctx context.Context, key string) (bool, error) {
	return true, nil
}

func (m *GapMockCache) Take(ctx context.Context, key string) (string, error) {
	return "", nil
}

func (m *GapMockCache) Clear(ctx context.Context) error {
	return nil
}

type failingReportGenerator struct{}

func (failingReportGenerator) GenerateReport(context.Context, *ExecutionTrace) (*ExecutionReport, error) {
	return nil, errors.New("report failed")
}

func TestNewDefaultsToInMemoryTeamInbox(t *testing.T) {
	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{})

	if _, ok := orch.TeamInbox.(*InMemoryTeamInbox); !ok {
		t.Fatalf("expected default team inbox to be in-memory, got %T", orch.TeamInbox)
	}
}
