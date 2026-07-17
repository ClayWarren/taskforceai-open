package orchestrator

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/mock"
)

type additionalTraceRepo struct {
	saveCalls int
	lastTrace *ExecutionTrace
	saveErr   error
}

type permissiveTelemetry struct {
	names []string
}

type trackingDecomposer struct {
	called bool
}

type testSpreadsheetWriter struct {
	t *testing.T
}

type testGeneratedFileRuntime struct{}

func (testGeneratedFileRuntime) NewGeneratedFileWorkspace() string {
	return ""
}

func (testGeneratedFileRuntime) ResolveGeneratedFileArtifact(request coretools.GeneratedFileArtifactRequest) (coretools.GeneratedFileArtifact, bool) {
	return coretools.GeneratedFileArtifact{
		Filename:  filepath.Base(request.Filepath),
		Filepath:  request.Filepath,
		MimeType:  request.MimeType,
		LocalPath: filepath.Join(request.Cwd, request.Filepath),
	}, true
}

func (w testSpreadsheetWriter) WriteSpreadsheet(_ context.Context, request enginecoretools.SpreadsheetWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(request.Path, []byte("spreadsheet"), 0o600); err != nil {
		return err
	}
	if w.t != nil {
		path := request.Path
		w.t.Cleanup(func() { _ = os.Remove(path) })
	}
	return nil
}

func (d *trackingDecomposer) GenerateSubtasks(context.Context, string, int) ([]string, error) {
	d.called = true
	return []string{"decomposed task"}, nil
}

func (t *permissiveTelemetry) StartSpan(ctx context.Context, name string, op string, attributes map[string]any, fn func(context.Context) error) error {
	t.names = append(t.names, name)
	if fn != nil {
		return fn(ctx)
	}
	return nil
}

func TestTaskOrchestratorBuildDefaultSubtasksIncludesContext(t *testing.T) {
	budget := 42.5
	orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{AgentCount: 2})
	orch.memories = []string{"prefers concise answers"}
	orch.projectInstructions = "follow project rules"
	orch.isAutonomous = true
	orch.soulContent = "build useful systems"
	orch.budgetUSD = &budget

	subtasks := orch.buildDefaultSubtasks("Solve the problem")
	if len(subtasks) != 2 {
		t.Fatalf("expected two subtasks, got %d", len(subtasks))
	}
	joined := strings.Join(subtasks, "\n")
	for _, expected := range []string{
		"<<ROLE:Researcher>>",
		"<<ROLE:Analyst>>",
		"prefers concise answers",
		"follow project rules",
		"build useful systems",
		"MISSION BUDGET: $42.50",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected subtasks to include %q; got %s", expected, joined)
		}
	}

	orch.budgetUSD = nil
	if got := strings.Join(orch.buildDefaultSubtasks("Solve again"), "\n"); !strings.Contains(got, "Autonomous allocation authorized") {
		t.Fatalf("expected autonomous allocation fallback, got %s", got)
	}
}

func TestLoadRolePromptUsesOverrideDirectory(t *testing.T) {
	provider := testPromptProvider{roles: map[string]string{"Researcher": "custom researcher"}}
	if got := loadRolePromptFromProvider(provider, "Researcher"); got != "custom researcher" {
		t.Fatalf("unexpected role prompt: %q", got)
	}
	if got := loadRolePromptFromProvider(provider, "Missing"); got != "" {
		t.Fatalf("missing prompt should be empty, got %q", got)
	}
}

func TestConsensusAggregationStrategySingleResult(t *testing.T) {
	deps := gapOrchestratorDeps(new(MockLLMClient))
	orch := New(testConfig(), deps, OrchestratorOptions{})
	strategy := &ConsensusAggregationStrategy{orch: orch}
	result, err := strategy.Aggregate(context.Background(), []string{"only answer"}, "task-1")
	if err != nil {
		t.Fatalf("unexpected aggregation error: %v", err)
	}
	if result != "only answer" {
		t.Fatalf("unexpected aggregate result: %q", result)
	}
}

func TestTaskOrchestratorTelemetryWrappers(t *testing.T) {
	run := func(t *testing.T, multimodal bool) {
		t.Helper()
		mockClient := new(MockLLMClient)
		telemetry := &permissiveTelemetry{}
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "synthesize {agent_responses}"
		orch := New(cfg, OrchestratorDeps{
			Client:       mockClient,
			UsageTracker: NewUsageTracker(),
			Budget:       NewBudgetManager(nil),
			Telemetry:    telemetry,
		}, OrchestratorOptions{AgentCount: 1})

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				onChunk(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "agent answer"}}}})
			}
		}).Once()
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "final answer"}}},
		}, nil).Once()

		if multimodal {
			result, trace, err := orch.OrchestrateMultimodal(context.Background(), "question", []agent.ContentPart{{Type: agent.ContentPartImageURL}})
			if err != nil || result != "final answer" || trace == nil {
				t.Fatalf("unexpected multimodal result=%q trace=%v err=%v", result, trace, err)
			}
		} else {
			result, trace, err := orch.Orchestrate(context.Background(), "question")
			if err != nil || result != "final answer" || trace == nil {
				t.Fatalf("unexpected result=%q trace=%v err=%v", result, trace, err)
			}
		}
		if len(telemetry.names) == 0 || telemetry.names[0] != "orchestrate" {
			t.Fatalf("expected orchestrate telemetry span, got %#v", telemetry.names)
		}
		mockClient.AssertExpectations(t)
	}

	t.Run("text", func(t *testing.T) { run(t, false) })
	t.Run("multimodal", func(t *testing.T) { run(t, true) })
}

func (r *additionalTraceRepo) SaveExecutionTrace(ctx context.Context, trace *ExecutionTrace) error {
	r.saveCalls++
	r.lastTrace = trace
	return r.saveErr
}

func (r *additionalTraceRepo) GetExecutionTrace(ctx context.Context, taskID string) (*ExecutionTrace, error) {
	return nil, nil
}

type additionalReportGenerator struct {
	report *ExecutionReport
	err    error
}

func (g *additionalReportGenerator) GenerateReport(ctx context.Context, trace *ExecutionTrace) (*ExecutionReport, error) {
	if g.err != nil {
		return nil, g.err
	}
	return g.report, nil
}

func TestTaskOrchestrator_GetToolUsageAndSingleAgentPrompt(t *testing.T) {
	deps := gapOrchestratorDeps(new(MockLLMClient))
	deps.PromptProvider = testPromptProvider{tools: map[string]string{
		"websearch":    "web prompt",
		"computer_use": "computer prompt",
	}}
	orch := New(testConfig(), deps, OrchestratorOptions{AgentCount: 1})

	orch.usageTracker.RecordToolUsage(agent.ToolEvent{ToolName: "team_message"})
	usage := orch.GetToolUsage()
	if len(usage) != 1 || usage[0].ToolName != "team_message" {
		t.Fatalf("unexpected tool usage payload: %+v", usage)
	}

	orch.computerUseEnabled = false
	orch.webSearchEnabled = false
	if prompt := orch.resolveSingleAgentPrompt("What is TaskForceAI?"); prompt != "" {
		t.Fatalf("expected empty single-agent prompt when no features enabled, got %q", prompt)
	}

	orch.webSearchEnabled = true
	webPrompt := orch.resolveSingleAgentPrompt("What is the latest AI news?")
	if webPrompt == "" {
		t.Fatal("expected web-search single-agent prompt")
	}
	if webPrompt != "web prompt" {
		t.Fatalf("expected web-search prompt %q, got %q", "web prompt", webPrompt)
	}

	filePrompt := orch.resolveSingleAgentPrompt("Create an Excel file called sunlight-distplanets.xlsx with planet light travel times.")
	if filePrompt != generatedFileSingleAgentPrompt {
		t.Fatalf("expected generated-file prompt to override web-search prompt, got %q", filePrompt)
	}
	if !isAllowedSystemOverride(orch, filePrompt) {
		t.Fatal("expected generated-file prompt to be an allowed system override")
	}

	orch.computerUseEnabled = true
	computerPrompt := orch.resolveSingleAgentPrompt("Use the browser to inspect this page")
	if computerPrompt == "" {
		t.Fatal("expected computer-use single-agent prompt")
	}
	if computerPrompt != "computer prompt" {
		t.Fatalf("expected computer-use prompt %q, got %q", "computer prompt", computerPrompt)
	}
}

func TestGeneratedFileRequestUsesFilePromptAndTools(t *testing.T) {
	restoreSpreadsheetWriter := enginecoretools.SetSpreadsheetWriter(testSpreadsheetWriter{t: t})
	t.Cleanup(restoreSpreadsheetWriter)
	restoreRuntime := coretools.SetEngineCoreToolRuntime(testGeneratedFileRuntime{})
	t.Cleanup(restoreRuntime)

	mockClient := new(MockLLMClient)
	orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1, WebSearchEnabled: true})

	prompt := "Create an Excel file called sunlight-distplanets.xlsx with planet light travel times."
	subtasks := orch.buildDefaultSubtasks(prompt)
	if len(subtasks) != 1 {
		t.Fatalf("expected one subtask, got %d", len(subtasks))
	}

	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		if len(params.Messages) == 0 || !strings.Contains(params.Messages[0].Content, generatedFileSingleAgentPrompt) {
			return false
		}
		if len(params.Messages) != 2 {
			return false
		}
		for _, tool := range params.Tools {
			if tool.Function.Name == "create_spreadsheet" {
				return true
			}
		}
		return false
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		if !ok {
			t.Fatal("expected stream callback")
		}
		zero := 0
		onChunk(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{ToolCalls: []agent.ToolCall{{
					Index: &zero,
					ID:    "call-file",
					Type:  "function",
					Function: agent.ToolCallFunction{
						Name:      "create_spreadsheet",
						Arguments: `{"filePath":"sunlight-distplanets.xlsx","sheets":[{"name":"Planets","rows":[["Planet","Light Travel Time"],["Earth","8.3 minutes"]]}]}`,
					},
				}}},
			}},
		})
	}).Once()
	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		return len(params.Messages) > 2
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		if !ok {
			t.Fatal("expected stream callback")
		}
		onChunk(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{Content: "Created sunlight-distplanets.xlsx."},
			}},
		})
	}).Once()

	result := RunAgentParallel(context.Background(), &AgentRunnerDeps{
		Config:          orch.config,
		Orchestrator:    orch,
		UsageTracker:    orch.usageTracker,
		ProgressTracker: orch.progressTracker,
		Budget:          orch.budget,
		Registry:        orch.registry,
	}, 0, subtasks[0])

	if result.Status != "success" {
		t.Fatalf("expected success, got %+v", result)
	}
	mockClient.AssertExpectations(t)
}

func TestGeneratedFileRequestBypassesDecomposer(t *testing.T) {
	decomposer := &trackingDecomposer{}
	orch := New(testConfig(), OrchestratorDeps{
		Client:     new(MockLLMClient),
		Decomposer: decomposer,
		Budget:     NewBudgetManager(nil),
	}, OrchestratorOptions{AgentCount: 3, WebSearchEnabled: true})

	subtasks := orch.executionSubtasks(context.Background(), "Create an Excel file called sun-lightdistanceplanetstravel.xlsx with planet light travel times.", nil)
	if decomposer.called {
		t.Fatal("generated-file request should bypass task decomposition")
	}
	if len(subtasks) != 1 {
		t.Fatalf("expected generated-file request to use one specialist subtask, got %d", len(subtasks))
	}
	if !strings.Contains(subtasks[0], generatedFileSingleAgentPrompt) {
		t.Fatalf("expected generated-file specialist prompt, got %q", subtasks[0])
	}
	if !strings.Contains(subtasks[0], "sun-lightdistanceplanetstravel.xlsx") {
		t.Fatalf("expected original file request to be preserved, got %q", subtasks[0])
	}
}

func TestTaskOrchestrator_SaveTraceBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("no repo or empty task id skip persistence", func(t *testing.T) {
		orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{})
		orch.saveTrace(ctx, "", nil, "goal", []string{"step"}, nil, "answer")
	})

	t.Run("report generation failure still persists trace", func(t *testing.T) {
		repo := &additionalTraceRepo{}
		orch := New(testConfig(), OrchestratorDeps{
			TraceRepo:       repo,
			ReportGenerator: &additionalReportGenerator{err: errors.New("report failed")},
			UsageTracker:    NewUsageTracker(),
			Budget:          NewBudgetManager(nil),
			Client:          new(MockLLMClient),
		}, OrchestratorOptions{})

		orch.saveTrace(ctx, "task-report-fail", nil, "goal", []string{"s1"}, []AgentResult{{AgentName: "a", Status: "success"}}, "final")

		if repo.saveCalls != 1 {
			t.Fatalf("expected one trace save call, got %d", repo.saveCalls)
		}
		if repo.lastTrace == nil {
			t.Fatal("expected saved trace payload")
		}
		if repo.lastTrace.TaskID != "task-report-fail" {
			t.Fatalf("unexpected task id in trace: %q", repo.lastTrace.TaskID)
		}
		if repo.lastTrace.Report != nil {
			t.Fatalf("expected nil report when generation fails, got %+v", repo.lastTrace.Report)
		}
	})

	t.Run("successful report generation attaches report to trace", func(t *testing.T) {
		repo := &additionalTraceRepo{}
		orch := New(testConfig(), OrchestratorDeps{
			TraceRepo: repo,
			ReportGenerator: &additionalReportGenerator{
				report: &ExecutionReport{Summary: "ok"},
			},
		}, OrchestratorOptions{})

		orch.saveTrace(ctx, "task-report-ok", nil, "goal", []string{"s1"}, []AgentResult{{AgentName: "a", Status: "success"}}, "final")

		if repo.saveCalls != 1 {
			t.Fatalf("expected one trace save call, got %d", repo.saveCalls)
		}
		if repo.lastTrace == nil || repo.lastTrace.Report == nil {
			t.Fatal("expected report to be attached to saved trace")
		}
		if repo.lastTrace.Report.Summary != "ok" {
			t.Fatalf("unexpected report summary: %q", repo.lastTrace.Report.Summary)
		}
	})
}
