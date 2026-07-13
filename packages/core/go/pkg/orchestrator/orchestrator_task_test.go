package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	toolspkg "github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOrchestratorRemainingCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("do orchestrate resumes plan encoded as generic slice", func(t *testing.T) {
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

		result, _, err := orch.doOrchestrate(ctx, "question", nil, "task-any-plan", nil, &ExecutionTrace{
			Plan: []any{"<<ROLE:Researcher>> from any plan"},
		})
		if err != nil || result != "final" {
			t.Fatalf("expected resumed plan orchestration, result=%q err=%v", result, err)
		}
	})

	t.Run("do orchestrate returns when all agents fail", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			saveTeamErr: errors.New("add member failed"),
		}
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 1})
		orch.TeamService = NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

		if _, _, err := orch.doOrchestrate(ctx, "question", nil, "task-all-fail", nil, nil); err == nil {
			t.Fatal("expected orchestration failure when all agents fail")
		}
	})
}

func TestOrchestratorSaveTracePushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()
	mockRepo := new(MockTraceRepo)
	mockRepo.On("SaveExecutionTrace", mock.Anything, mock.Anything).Return(nil).Once()
	orch := New(testConfig(), OrchestratorDeps{
		Client:          new(MockLLMClient),
		Budget:          NewBudgetManager(nil),
		UsageTracker:    NewUsageTracker(),
		TraceRepo:       mockRepo,
		ReportGenerator: failingReportGenerator{},
	}, OrchestratorOptions{})
	orch.saveTrace(ctx, "task-report-fail", nil, "goal", []string{"sub"}, []AgentResult{{Status: "success", Response: "ok"}}, "final")
	mockRepo.AssertExpectations(t)
}

func TestOrchestratorSessionCancelCoverageGapPaths(t *testing.T) {
	orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{})

	if orch.CancelSessionPrompt("") {
		t.Fatal("expected empty session cancel to be ignored")
	}
	orch.clearSessionCancel("")

	ctx, cancel := context.WithCancel(context.Background())
	orch.registerSessionCancel("session-1", cancel)
	if !orch.CancelSessionPrompt("session-1") {
		t.Fatal("expected registered session cancel to succeed")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected session cancel function to fire")
	}
}

func TestOrchestratorStrategyGap(t *testing.T) {
	o := &TaskOrchestrator{config: config.Config{}}

	// Test Default Strategy
	strategy := o.getAggregationStrategy("unknown", "")
	assert.NotNil(t, strategy)
	assert.IsType(t, &ConsensusAggregationStrategy{}, strategy)

	// Test ConsensusAggregate Single Item
	cons := &ConsensusAggregationStrategy{orch: o}
	res, err := cons.Aggregate(context.Background(), []string{"single"}, "")
	require.NoError(t, err)
	assert.Equal(t, "single", res)
}

func TestParseSubtaskOverrides(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantRole   string
		wantSystem string
	}{
		{
			name:       "extracts Researcher role",
			input:      "<<ROLE:Researcher>>\n<<SYSTEM_OVERRIDE:You are a researcher>>\n\nWhat is Go?",
			wantRole:   "Researcher",
			wantSystem: "You are a researcher",
		},
		{
			name:       "extracts Analyst role",
			input:      "<<ROLE:Analyst>>\n<<SYSTEM_OVERRIDE:Analyze data>>\n\nExplain quantum computing",
			wantRole:   "Analyst",
			wantSystem: "Analyze data",
		},
		{
			name:       "extracts Skeptic role",
			input:      "<<ROLE:Skeptic>>\n<<SYSTEM_OVERRIDE:Question everything>>\n\nIs AI safe?",
			wantRole:   "Skeptic",
			wantSystem: "Question everything",
		},
		{
			name:       "extracts Pragmatist role",
			input:      "<<ROLE:Pragmatist>>\n<<SYSTEM_OVERRIDE:Be practical>>\n\nHow to deploy?",
			wantRole:   "Pragmatist",
			wantSystem: "Be practical",
		},
		{
			name:       "no overrides returns empty",
			input:      "Just a plain query",
			wantRole:   "",
			wantSystem: "",
		},
		{
			name:       "cleans markers from query",
			input:      "<<ROLE:Analyst>>\n<<SYSTEM_OVERRIDE:Think>>\n\nWhat is 2+2?",
			wantRole:   "Analyst",
			wantSystem: "Think",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			role, sys, clean := parseSubtaskOverrides(tt.input)
			if role != tt.wantRole {
				t.Errorf("role = %q, want %q", role, tt.wantRole)
			}
			if sys != tt.wantSystem {
				t.Errorf("systemOverride = %q, want %q", sys, tt.wantSystem)
			}
			if role != "" && (strings.Contains(clean, "<<ROLE:") || strings.Contains(clean, "<<SYSTEM_OVERRIDE:")) {
				t.Errorf("cleanQuery still contains markers: %q", clean)
			}
		})
	}
}

func TestTaskOrchestratorAggregateResultsGapCoverage(t *testing.T) {
	ctx := context.Background()

	t.Run("returns error when all successful agents returned empty responses", func(t *testing.T) {
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 2})

		_, err := orch.aggregateResults(ctx, []AgentResult{
			{AgentID: 1, Status: "success", Response: "   "},
			{AgentID: 2, Status: "failed", Response: "ignored"},
		}, "question", "task-empty")
		if err == nil || !strings.Contains(err.Error(), "no usable agent response") {
			t.Fatalf("expected empty-response aggregation error, got %v", err)
		}
	})

	t.Run("computer use returns agent synthesis without tool-less validation", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1, ComputerUseEnabled: true})

		result, err := orch.aggregateResults(ctx, []AgentResult{
			{
				AgentID:  0,
				Status:   "success",
				Response: "There are no visible open windows on the desktop.",
				ToolEvents: []agent.ToolEvent{{
					ToolName: "computer_use",
					Success:  true,
				}},
			},
		}, "Use Computer Use only. Take one screenshot.", "task-computer-use")
		require.NoError(t, err)
		assert.Equal(t, "There are no visible open windows on the desktop.", result)
		mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("current data returns synthesis without stale validation", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})

		result, err := orch.aggregateResults(ctx, []AgentResult{
			{
				AgentID:  0,
				Status:   "success",
				Response: "Today's AI news includes a newly published model release.",
				ToolEvents: []agent.ToolEvent{{
					ToolName: "search_web",
					Success:  true,
				}},
			},
		}, "What is the latest AI news today?", "task-current-news")
		require.NoError(t, err)
		assert.Equal(t, "Today's AI news includes a newly published model release.", result)
		mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("consensus aggregate uses telemetry wrapper and cache hit", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockCache := &MockCache{Data: map[string]string{}}
		telemetry := &permissiveTelemetry{}
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Combine: {agent_responses}"
		orch := New(cfg, OrchestratorDeps{
			Client:       mockClient,
			Cache:        mockCache,
			Budget:       NewBudgetManager(nil),
			UsageTracker: NewUsageTracker(),
			Telemetry:    telemetry,
		}, OrchestratorOptions{AgentCount: 2, CacheNamespace: "test-ns"})
		if err := orch.llmCache.SetCachedSynthesis(ctx, "test-ns", []string{"answer-a", "answer-b"}, "cached synthesis"); err != nil {
			t.Fatalf("seed synthesis cache: %v", err)
		}

		strategy := &ConsensusAggregationStrategy{orch: orch}
		result, err := strategy.Aggregate(ctx, []string{"answer-a", "answer-b"}, "task-cache")
		if err != nil {
			t.Fatalf("aggregate with cache hit failed: %v", err)
		}
		if result != "cached synthesis" {
			t.Fatalf("expected cached synthesis, got %q", result)
		}
		if len(telemetry.names) == 0 || telemetry.names[0] != "aggregateConsensus" {
			t.Fatalf("expected telemetry span, got %#v", telemetry.names)
		}
		mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("validate answer returns synthesis when llm returns empty choices", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{},
		}, nil).Once()

		got, err := orch.validateAnswer(ctx, "question", []string{"a"}, "synthesis", "task-id")
		if err != nil || got != "synthesis" {
			t.Fatalf("expected synthesis fallback, got %q err=%v", got, err)
		}
	})

	t.Run("validate answer returns synthesis when llm call fails", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("llm failed")).Once()

		got, err := orch.validateAnswer(ctx, "question", []string{"a"}, "synthesis", "task-id")
		if err != nil || got != "synthesis" {
			t.Fatalf("expected synthesis fallback on llm failure, got %q err=%v", got, err)
		}
	})

	t.Run("aggregate falls back to agent response when validation rejects empty synthesis", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 2})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: ""}}},
		}, nil).Once()
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: ""}}},
		}, nil).Once()

		got, err := orch.aggregateResults(ctx, []AgentResult{
			{AgentID: 1, Status: "success", Response: "short"},
			{AgentID: 2, Status: "success", Response: "longer fallback answer"},
		}, "question", "task-empty-validation")
		if err != nil || got != "longer fallback answer" {
			t.Fatalf("expected longest agent fallback, got %q err=%v", got, err)
		}
	})
}

func TestTaskOrchestrator_Budget(t *testing.T) {
	budget := 10.5
	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{
		BudgetUSD: &budget,
	})

	usage := orch.GetBudgetUsage()
	assert.Equal(t, 0.0, usage.ConsumedUSD)
}

func TestTaskOrchestrator_Cancel(t *testing.T) {
	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{})

	t.Run("Cancel missing session", func(t *testing.T) {
		ok := orch.CancelSessionPrompt("invalid")
		assert.False(t, ok)
	})

	t.Run("Cancel existing session", func(t *testing.T) {
		cancelled := false
		cancelFunc := func() {
			cancelled = true
		}
		orch.registerSessionCancel("s1", cancelFunc)
		ok := orch.CancelSessionPrompt("s1")
		assert.True(t, ok)
		assert.True(t, cancelled)
	})

	t.Run("Registration validation", func(t *testing.T) {
		orch.registerSessionCancel("", nil)
		orch.clearSessionCancel("")
		// Should not panic or do anything
	})
}

func TestTaskOrchestrator_CancelOrchestrate(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	orch := New(cfg, OrchestratorDeps{
		Client:       mockClient,
		UsageTracker: NewUsageTracker(),
	}, OrchestratorOptions{AgentCount: 1})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, _, err := orch.Orchestrate(ctx, "query")
	require.Error(t, err)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestTaskOrchestrator_Orchestrate(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	cfg.Gateway.Model = "test-model"
	cfg.Orchestrator.ParallelAgents = 1
	cfg.Orchestrator.AggregationStrategy = "consensus"
	cfg.Orchestrator.SynthesisPrompt = "synthesis prompt"

	orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{
		AgentCount: 1,
	})

	ctx := context.Background()

	// 1. Mock Agent execution (RunAgentParallel -> GatewayAgent.Run)
	// Agent will call CreateChatCompletionStream
	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		if ok && onChunk != nil {
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{{
					Delta: agent.ChatCompletionChunkDelta{Content: "agent response"},
				}},
			})
		}
	}).Once()

	// 2. Mock Synthesis (aggregateResults -> ConsensusAggregationStrategy.Aggregate -> runSinglePrompt -> CreateChatCompletion)
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: "final synthesis"},
		}},
	}, nil).Once()

	res, trace, err := orch.Orchestrate(ctx, "What is Go?")

	require.NoError(t, err)
	assert.Equal(t, "final synthesis", res)
	assert.NotNil(t, trace)
	assert.Len(t, trace.AgentResults, 1)
	assert.Equal(t, "agent response", trace.AgentResults[0].Response)

	mockClient.AssertExpectations(t)
}

func TestTaskOrchestrator_OrchestrateMultimodal(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{
		AgentCount: 1,
	})

	ctx := context.Background()
	images := []agent.ContentPart{{Type: agent.ContentPartImageURL}}

	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		// Verify images are passed
		return len(params.Messages) > 0
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		if ok && onChunk != nil {
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{{
					Delta: agent.ChatCompletionChunkDelta{Content: "vision response"},
				}},
			})
		}
	}).Once()

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: "final vision synthesis"},
		}},
	}, nil).Once()

	res, _, err := orch.OrchestrateMultimodal(ctx, "Analyze this", images)
	require.NoError(t, err)
	assert.Equal(t, "final vision synthesis", res)
}

type MockTraceRepo struct {
	mock.Mock
}

func (m *MockTraceRepo) SaveExecutionTrace(ctx context.Context, trace *ExecutionTrace) error {
	args := m.Called(ctx, trace)
	return args.Error(0)
}

func (m *MockTraceRepo) GetExecutionTrace(ctx context.Context, taskID string) (*ExecutionTrace, error) {
	args := m.Called(ctx, taskID)
	res, _ := args.Get(0).(*ExecutionTrace)
	return res, args.Error(1)
}

func TestTaskOrchestrator_Registration(t *testing.T) {
	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{})

	t.Run("OnProgress", func(t *testing.T) {
		stop := orch.OnProgress(func(status []AgentStatusSnapshot) {})
		assert.NotNil(t, stop)
	})

	t.Run("OnToolUsage", func(t *testing.T) {
		stop := orch.OnToolUsage(func(ev agent.ToolEvent, history []agent.ToolEvent) {})
		assert.NotNil(t, stop)
	})

	t.Run("GetAgentCount", func(t *testing.T) {
		assert.Equal(t, 4, orch.GetAgentCount())
	})
}

func TestTaskOrchestrator_ResumeOrchestration_PlanAnyAndCompletedStep(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	cfg.Orchestrator.ParallelAgents = 1
	orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{
		AgentCount: 1,
	})

	existingTrace := &ExecutionTrace{
		Plan: []any{"Recovered plan item"},
		Steps: []AgentResult{
			{
				AgentID:   1,
				AgentName: "Agent-1",
				Status:    "success",
				Response:  "already completed",
			},
		},
	}

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: "validated resumed output"},
		}},
	}, nil).Once()

	res, trace, err := orch.ResumeOrchestration(context.Background(), "ignored query", nil, "", nil, existingTrace)

	require.NoError(t, err)
	require.NotNil(t, trace)
	assert.Equal(t, "validated resumed output", res)
	assert.Equal(t, []string{"Recovered plan item"}, trace.SubQuestions)
	assert.Len(t, trace.AgentResults, 1)
	assert.Equal(t, "already completed", trace.AgentResults[0].Response)
	mockClient.AssertExpectations(t)
}

func TestTaskOrchestrator_ResumeOrchestration_ReusesCompletedStep(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	cfg.Orchestrator.ParallelAgents = 2
	cfg.Orchestrator.SynthesisPrompt = "synth {num_responses} {agent_responses}"
	orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{
		AgentCount: 2,
	})

	existingTrace := &ExecutionTrace{
		Plan: []string{
			"First subtask from saved plan",
			"Second subtask from saved plan",
		},
		Steps: []AgentResult{
			{
				AgentID:   1,
				AgentName: "Agent-1",
				Status:    "success",
				Response:  "checkpoint result",
			},
		},
	}

	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).
		Return(nil).
		Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok && onChunk != nil {
				onChunk(agent.ChatCompletionChunk{
					Choices: []agent.ChatCompletionChunkChoice{{
						Delta: agent.ChatCompletionChunkDelta{Content: "fresh result"},
					}},
				})
			}
		}).
		Once()

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: "final resumed answer"},
		}},
	}, nil).Twice()

	res, trace, err := orch.ResumeOrchestration(context.Background(), "ignored query", nil, "task-123", nil, existingTrace)

	require.NoError(t, err)
	require.NotNil(t, trace)
	assert.Equal(t, "final resumed answer", res)
	assert.Equal(t, existingTrace.Plan, trace.SubQuestions)
	assert.Len(t, trace.AgentResults, 2)
	assert.Equal(t, "checkpoint result", trace.AgentResults[0].Response)
	assert.Equal(t, "fresh result", trace.AgentResults[1].Response)
	mockClient.AssertExpectations(t)
}

func TestTaskOrchestrator_SaveTrace(t *testing.T) {
	mockRepo := new(MockTraceRepo)
	orch := New(testConfig(), OrchestratorDeps{
		TraceRepo: mockRepo,
	}, OrchestratorOptions{})

	mockRepo.On("SaveExecutionTrace", mock.Anything, mock.Anything).Return(nil).Once()

	orch.saveTrace(context.Background(), "task-1", nil, "goal", []string{"sub"}, []AgentResult{}, "synth")

	mockRepo.AssertExpectations(t)
}

func TestTaskOrchestrator_Wrappers(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := testConfig()
	orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{
		AgentCount: 1,
	})

	ctx := context.Background()

	// Mock for both
	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		if ok && onChunk != nil {
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{{
					Delta: agent.ChatCompletionChunkDelta{Content: "resp"},
				}},
			})
		}
	}).Twice()

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: "synth"},
		}},
	}, nil).Twice()

	_, _, err := orch.OrchestrateWithTask(ctx, "q", "task-1", nil)
	require.NoError(t, err)

	_, _, err = orch.OrchestrateMultimodalWithTask(ctx, "q", nil, "task-2", nil)
	assert.NoError(t, err)
}

func TestTeamServicePushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("cleanup tolerates inbox removal failures", func(t *testing.T) {
		inbox := newTestTeamInbox(t.TempDir())
		inbox.removeErr = errors.New("remove failed")
		store := &mockStore{
			teams: map[string]*TeamInfo{
				"clean-me": {
					Name:          "clean-me",
					LeadSessionID: "lead",
					Members: []TeamMember{
						{Name: "worker", SessionID: "worker", Status: MemberStatusShutdown},
					},
				},
			},
			tasks: map[string][]TeamTask{},
		}
		svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		if err := inbox.Write("clean-me", "worker", agent.InboxMessage{ID: "1", From: "lead", Text: "done"}); err != nil {
			t.Fatalf("seed inbox: %v", err)
		}
		if err := svc.Cleanup(ctx, "clean-me"); err != nil {
			t.Fatalf("cleanup should succeed despite inbox removal warnings: %v", err)
		}
	})
}

func TestTeamToolPushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{
		teams: map[string]*TeamInfo{
			"tool-err": {
				Name:          "tool-err",
				LeadSessionID: "lead-session",
				Members:       []TeamMember{{Name: "worker", SessionID: "worker-session", Status: MemberStatusReady}},
			},
		},
		tasks: map[string][]TeamTask{},
	}
	inbox := newTestTeamInbox(t.TempDir())
	svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	teamTools := NewTeamTools(svc)
	registry := toolspkg.NewToolRegistry()
	teamTools.Register(registry)

	t.Run("registered team tools propagate service errors", func(t *testing.T) {
		ctxWithSession := context.WithValue(ctx, sessionIDKey, "lead-session")
		if err := inbox.Write("tool-err", "worker", agent.InboxMessage{ID: "seed", From: "lead", Text: "seed"}); err != nil {
			t.Fatalf("seed worker inbox: %v", err)
		}
		inbox.writeErr = errors.New("write failed")

		messageTool, ok := registry.Get("team_message")
		if !ok {
			t.Fatal("team_message not registered")
		}
		if _, err := messageTool.Execute(ctxWithSession, `{"to":"worker","text":"hello"}`); err == nil {
			t.Fatal("expected team_message service error")
		}

		errorStore := &erroringTeamToolStore{
			mockStore:   store,
			getTasksErr: errors.New("tasks failed"),
		}
		errorSvc := NewTeamService(errorStore, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		errorTools := NewTeamTools(errorSvc)
		errorRegistry := toolspkg.NewToolRegistry()
		errorTools.Register(errorRegistry)
		tasksTool, ok := errorRegistry.Get("team_tasks")
		if !ok {
			t.Fatal("team_tasks not registered")
		}
		if _, err := tasksTool.Execute(ctxWithSession, `{"action":"list"}`); err == nil {
			t.Fatal("expected team_tasks service error")
		}
	})
}
