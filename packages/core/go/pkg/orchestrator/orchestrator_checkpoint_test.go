package orchestrator

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOrchestratorCheckpointCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("exec agents resumes successful checkpoint results", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 2})
		_, err := orch.TeamService.Create(ctx, "checkpoint-team", "lead-session", false)
		require.NoError(t, err)

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				cb(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "agent two"}}}})
			}
		}).Once()

		results := orch.execAgentsWithCheckpoint(
			ctx,
			"checkpoint-team",
			[]string{"<<ROLE:Researcher>> task one", "<<ROLE:Analyst>> task two"},
			nil,
			"task-checkpoint",
			nil,
			[]AgentResult{{
				AgentID:   1,
				AgentName: "Researcher",
				Status:    "success",
				Response:  "cached answer",
			}},
		)
		require.Len(t, results, 2)
		assert.Equal(t, "cached answer", results[0].Response)
		assert.Equal(t, "success", results[1].Status)
		mockClient.AssertExpectations(t)
	})

	t.Run("exec agents starts runners concurrently", func(t *testing.T) {
		client := &blockingParallelLLMClient{
			started: make(chan struct{}, 2),
			release: make(chan struct{}),
		}
		orch := New(testConfig(), gapOrchestratorDeps(client), OrchestratorOptions{AgentCount: 2})
		_, err := orch.TeamService.Create(ctx, "parallel-team", "lead-session", false)
		require.NoError(t, err)

		done := make(chan []AgentResult, 1)
		go func() {
			done <- orch.execAgentsWithCheckpoint(
				ctx,
				"parallel-team",
				[]string{"<<ROLE:Researcher>> task one", "<<ROLE:Analyst>> task two"},
				nil,
				"task-parallel",
				nil,
				nil,
			)
		}()

		for range 2 {
			select {
			case <-client.started:
			case <-time.After(500 * time.Millisecond):
				t.Fatal("expected both agent streams to start before either one completed")
			}
		}

		close(client.release)
		select {
		case results := <-done:
			require.Len(t, results, 2)
			assert.Equal(t, "success", results[0].Status)
			assert.Equal(t, "success", results[1].Status)
		case <-time.After(500 * time.Millisecond):
			t.Fatal("expected parallel agent execution to finish after release")
		}
	})

	t.Run("exec agents records add member failures", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore: &mockStore{
				teams: map[string]*TeamInfo{
					"fail-team": {Name: "fail-team", LeadSessionID: "lead"},
				},
				tasks: map[string][]TeamTask{},
			},
			saveTeamErr: errors.New("add member failed"),
		}
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 1})
		orch.TeamService = NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

		results := orch.execAgentsWithCheckpoint(ctx, "fail-team", []string{"task"}, nil, "", nil, nil)
		require.Len(t, results, 1)
		assert.Equal(t, "error", results[0].Status)
		assert.Contains(t, results[0].Response, "add member failed")
	})

	t.Run("aggregate results returns error when no usable responses", func(t *testing.T) {
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 1})
		_, err := orch.aggregateResults(ctx, []AgentResult{{Status: "success", Response: "   "}}, "question", "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no usable agent response")
	})

	t.Run("do orchestrate tolerates team create failure", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			saveTeamErr: errors.New("create team failed"),
		}
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 1})
		orch.TeamService = NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

		_, _, err := orch.doOrchestrate(ctx, "question", nil, "task-create-fail", nil, nil)
		require.Error(t, err)
	})

	t.Run("do orchestrate resumes existing plan", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				cb(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "done"}}}})
			}
		}).Once()
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "final"}}},
		}, nil).Once()

		result, trace, err := orch.doOrchestrate(ctx, "question", nil, "task-plan", nil, &ExecutionTrace{
			Plan: []string{"<<ROLE:Researcher>> planned task"},
		})
		require.NoError(t, err)
		assert.Equal(t, "final", result)
		require.NotNil(t, trace)
	})

	t.Run("load role prompt and soul content use provider", func(t *testing.T) {
		provider := testPromptProvider{
			roles: map[string]string{"Researcher": "role prompt"},
			soul:  "soul content",
		}
		if got := loadRolePromptFromProvider(provider, "Researcher"); got != "role prompt" {
			t.Fatalf("expected role prompt, got %q", got)
		}
		if got := loadSoulContentFromProvider(provider); got != "soul content" {
			t.Fatalf("expected soul content, got %q", got)
		}
	})
}
