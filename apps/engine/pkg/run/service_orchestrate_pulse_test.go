package run

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/infrastructure/crypto/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestHandleOrchestrateTaskProgressUpdate_WithoutBudget(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "progress-handler-no-budget"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	orch := newTestOrchestrator(new(llmClientMock))
	handleOrchestrateTaskProgressUpdate(
		registry,
		taskID,
		orch,
		OrchestrateTaskOptions{},
		[]orchestrator.AgentStatusSnapshot{{AgentID: 0, Status: orchestrator.StatusProcessing}},
	)
}

func TestHandleOrchestrateTaskToolUsageUpdate_WithBudget(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("UpdateProgress", "tool-budget", nil, mock.Anything, mock.MatchedBy(func(budget *BudgetUsage) bool {
		return budget != nil
	})).Return(nil)

	budget := 1.25
	handleOrchestrateTaskToolUsageUpdate(
		context.Background(),
		reg,
		"tool-budget",
		7,
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{Budget: &budget},
		[]agent.ToolEvent{{ToolName: "search", Status: "completed"}},
	)

	reg.AssertExpectations(t)
}

func TestLogPulseStateUpdateError(t *testing.T) {
	logPulseStateUpdateError(nil)
	logPulseStateUpdateError(errors.New("pulse state failed"))
}

func TestHandleOrchestrateTaskProgressUpdate_PreservesExistingToolEventsWhenEmpty(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("UpdateProgress", "progress-preserve-tools", mock.Anything, nil, mock.Anything).Return(nil)

	handleOrchestrateTaskProgressUpdate(
		reg,
		"progress-preserve-tools",
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{},
		[]orchestrator.AgentStatusSnapshot{{AgentID: 0, Status: orchestrator.StatusProcessing}},
	)

	reg.AssertExpectations(t)
}

func TestHandleOrchestrateTaskProgressUpdate_UpdateError(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("UpdateProgress", "progress-update-error", mock.Anything, nil, mock.Anything).Return(errors.New("update failed"))

	handleOrchestrateTaskProgressUpdate(
		reg,
		"progress-update-error",
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{},
		[]orchestrator.AgentStatusSnapshot{{AgentID: 0, Status: orchestrator.StatusProcessing}},
	)

	reg.AssertExpectations(t)
}

func TestHandleOrchestrateTaskProgressUpdate_SkipsRecordedToolUsage(t *testing.T) {
	reg := new(mockTaskRegistrar)
	usage := orchestrator.NewUsageTracker()
	orch := orchestrator.New(coreconfig.Config{}, orchestrator.OrchestratorDeps{
		Client:       new(llmClientMock),
		UsageTracker: usage,
	}, orchestrator.OrchestratorOptions{AgentCount: 1})
	agentID := 0
	toolEvents := []agent.ToolEvent{
		{
			AgentID:    &agentID,
			AgentLabel: "agent-1",
			ToolName:   "search_web",
			Arguments:  map[string]any{"query": "latest AI news"},
			Status:     "running",
			Success:    true,
		},
	}
	usage.RecordToolUsage(toolEvents[0])
	reg.On("UpdateProgress", "progress-with-tools", mock.Anything, nil, mock.Anything).Return(nil)

	handleOrchestrateTaskProgressUpdate(
		reg,
		"progress-with-tools",
		orch,
		OrchestrateTaskOptions{},
		[]orchestrator.AgentStatusSnapshot{{AgentID: 0, Status: orchestrator.StatusProcessing}},
	)

	reg.AssertExpectations(t)
}

func TestHandleOrchestrateTaskToolUsageUpdate(t *testing.T) {
	reg := new(mockTaskRegistrar)
	toolEvents := []agent.ToolEvent{
		{
			AgentLabel: "agent-1",
			ToolName:   "search",
			Arguments:  map[string]any{"query": "news"},
			Success:    true,
			Sources:    []agent.SourceReference{{URL: "https://news.example", Title: "News"}},
		},
	}
	reg.On("UpdateProgress", "tool-progress", nil, toolEvents, mock.Anything).Return(nil)

	handleOrchestrateTaskToolUsageUpdate(
		context.Background(),
		reg,
		"tool-progress",
		42,
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{},
		toolEvents,
	)

	reg.AssertExpectations(t)
}

func TestHandleOrchestrateTaskToolUsageUpdate_PersistsGeneratedFile(t *testing.T) {
	restore(t, &PersistGeneratedFileArtifacts)

	reg := new(mockTaskRegistrar)
	toolEvents := []agent.ToolEvent{
		{
			AgentLabel: "agent-1",
			ToolName:   "create_chart",
			Arguments:  map[string]any{"filePath": "chart.png"},
			Success:    true,
			GeneratedFile: &agent.GeneratedFile{
				Filename:  "chart.png",
				MimeType:  "image/png",
				LocalPath: "/tmp/chart.png",
			},
		},
	}
	PersistGeneratedFileArtifacts = func(_ context.Context, input GeneratedFilePersistenceInput) ([]agent.ToolEvent, error) {
		require.Equal(t, 42, input.UserID)
		require.Equal(t, "tool-progress-file", input.TaskID)
		require.Len(t, input.Events, 1)
		input.Events[0].GeneratedFile.FileID = "file-generated"
		input.Events[0].GeneratedFile.ArtifactID = "artifact-generated"
		input.Events[0].GeneratedFile.DownloadURL = "/api/v1/developer/files/file-generated/content"
		return input.Events, nil
	}

	reg.On("UpdateProgress", "tool-progress-file", nil, mock.MatchedBy(func(events []agent.ToolEvent) bool {
		return len(events) == 1 &&
			events[0].GeneratedFile != nil &&
			events[0].GeneratedFile.FileID == "file-generated" &&
			events[0].GeneratedFile.ArtifactID == "artifact-generated" &&
			events[0].GeneratedFile.DownloadURL != ""
	}), mock.Anything).Return(nil)

	handleOrchestrateTaskToolUsageUpdate(
		context.Background(),
		reg,
		"tool-progress-file",
		42,
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{},
		toolEvents,
	)

	reg.AssertExpectations(t)
}

func TestHandleOrchestrateTaskToolUsageUpdate_PersistAndUpdateErrors(t *testing.T) {
	restore(t, &PersistGeneratedFileArtifacts)
	PersistGeneratedFileArtifacts = func(context.Context, GeneratedFilePersistenceInput) ([]agent.ToolEvent, error) {
		return nil, errors.New("persist failed")
	}

	reg := new(mockTaskRegistrar)
	toolEvents := []agent.ToolEvent{{ToolName: "create_chart", Success: true}}
	reg.On("UpdateProgress", "tool-progress-error", nil, toolEvents, mock.Anything).Return(errors.New("update failed"))

	handleOrchestrateTaskToolUsageUpdate(
		context.Background(),
		reg,
		"tool-progress-error",
		42,
		newTestOrchestrator(new(llmClientMock)),
		OrchestrateTaskOptions{},
		toolEvents,
	)

	reg.AssertExpectations(t)
}

func TestInitOrchestrator(t *testing.T) {
	restore(t, &WebEnvLoader)

	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	cfg := coreconfig.Config{
		Gateway: coreconfig.GatewayConfig{
			Model: "gpt-4",
		},
		Models: coreconfig.ModelsConfig{
			Default: "gpt-4",
			Options: []coreconfig.ModelOption{{ID: "gpt-4"}},
		},
	}

	orch := initOrchestrator(OrchestratorInitInput{
		Config:               cfg,
		UserID:               1,
		WebSearchEnabled:     true,
		CodeExecutionEnabled: true,
	})
	if orch == nil {
		t.Fatal("expected orchestrator")
	}
}

func TestInitOrchestrator_ImageModelDisablesWebSearchAndCodeExecution(t *testing.T) {
	cfg := coreconfig.Config{
		Gateway: coreconfig.GatewayConfig{Model: "gemini-2.5-flash-image"},
	}
	orch := initOrchestrator(OrchestratorInitInput{
		Config:               cfg,
		UserID:               2,
		LLMAdapter:           new(llmClientMock),
		WebSearchEnabled:     true,
		CodeExecutionEnabled: true,
	})
	require.NotNil(t, orch)
	assert.NotNil(t, orch)
}

func TestInitOrchestrator_QuickModeDisablesDecomposer(t *testing.T) {
	cfg := coreconfig.Config{
		Gateway: coreconfig.GatewayConfig{Model: "openai/gpt-5.6-sol"},
	}
	orch := initOrchestrator(OrchestratorInitInput{
		Config:               cfg,
		UserID:               1,
		LLMAdapter:           new(llmClientMock),
		QuickModeEnabled:     true,
		WebSearchEnabled:     true,
		CodeExecutionEnabled: true,
	})
	require.NotNil(t, orch)
}

func TestEffectiveRoleModelsSuppressesOverridesInQuickMode(t *testing.T) {
	roleModels := map[string]string{"Researcher": "openai/gpt-5.6-sol"}

	assert.Nil(t, effectiveRoleModels(OrchestratorInitInput{
		QuickModeEnabled: true,
		RoleModels:       roleModels,
	}))
	assert.Equal(t, roleModels, effectiveRoleModels(OrchestratorInitInput{
		QuickModeEnabled: false,
		RoleModels:       roleModels,
	}))
}

func TestInitRegistryProgressZeroAgentsUsesOne(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("UpdateProgress", "progress-init", mock.Anything, mock.Anything, mock.Anything).Return(nil)

	err := initRegistryProgress(reg, "progress-init", coreconfig.Config{Orchestrator: coreconfig.OrchestratorConfig{ParallelAgents: 0}}, false)
	require.NoError(t, err)
	reg.AssertExpectations(t)
}

func TestLoadExecutionTraceForResume(t *testing.T) {
	ctx := context.Background()
	userID := int32(42)
	otherUserID := int32(99)

	t.Run("nil repository", func(t *testing.T) {
		assert.Nil(t, loadExecutionTraceForResume(ctx, nil, "task-1", &userID))
	})

	t.Run("missing trace", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		repo := NewRepositoryFromQueries(db.New(mock))
		mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnError(errors.New("not found"))
		assert.Nil(t, loadExecutionTraceForResume(ctx, repo, "task-1", &userID))
	})

	t.Run("ownership mismatch", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		repo := NewRepositoryFromQueries(db.New(mock))
		now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
		mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(
			pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
				AddRow("trace-1", "task-1", &otherUserID, "goal", []byte("[]"), []byte("[]"), []byte("{}"), []byte("{}"), []byte("{}"), now),
		)
		assert.Nil(t, loadExecutionTraceForResume(ctx, repo, "task-1", &userID))
	})

	t.Run("resume existing trace", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		repo := NewRepositoryFromQueries(db.New(mock))
		now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
		mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(
			pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
				AddRow("trace-1", "task-1", &userID, "goal", []byte("[]"), []byte("[]"), []byte("{}"), []byte("{}"), []byte("{}"), now),
		)
		trace := loadExecutionTraceForResume(ctx, repo, "task-1", &userID)
		require.NotNil(t, trace)
		assert.Equal(t, "trace-1", trace.ID)
	})
}

func TestLoadMemoryStore(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}
	_, err := loadMemoryStore(context.Background())
	require.Error(t, err)

	mock := dbtest.NewMockPool(t)
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	store, err := loadMemoryStore(context.Background())
	require.NoError(t, err)
	assert.NotNil(t, store)
}

func TestLoadRunUserContext_ProjectInstructionsCacheHit(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mockRedis := withMockRedis(t)
	withDBQueries(t, db.New(mock))

	userID := int32(12)
	projectID := int32(77)
	require.NoError(t, mockRedis.Set(
		context.Background(),
		"project_instructions:personal:12:77",
		[]byte("cached project prompt"),
		time.Minute,
	))

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, false))
	mock.ExpectQuery(`SELECT .* FROM memories`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at",
		}))
	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()))

	ctx, err := loadRunUserContext(context.Background(), UserContextLoadInput{
		UserID:    userID,
		ProjectID: &projectID,
	})
	require.NoError(t, err)
	assert.Equal(t, "cached project prompt", ctx.ProjectInstructions)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadRunUserContext_SkipsSecondGithubAccount(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("c", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mock := dbtest.NewMockPool(t)

	restore(t, &DBQueriesGetter)
	DBQueriesGetter = func(context.Context) (*db.Queries, error) { return db.New(mock), nil }

	userID := int32(91)
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, false))
	mock.ExpectQuery(`SELECT .* FROM memories`).WithArgs(userID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at",
		}))

	ghToken, err := crypto.Encrypt("gh-token")
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT .* FROM accounts`).WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()).
			AddRow("acc-gh-1", userID, "oauth", "github", "acct-gh-1", nil, &ghToken, nil, nil, nil, nil, nil).
			AddRow("acc-gh-2", userID, "oauth", "github", "acct-gh-2", nil, &ghToken, nil, nil, nil, nil, nil))

	ctx, err := loadRunUserContext(context.Background(), UserContextLoadInput{UserID: userID})
	require.NoError(t, err)
	assert.Equal(t, "gh-token", ctx.GithubToken)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadRunUserContext_SkipsSecondGoogleDriveAccount(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("c", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "google-client-secret")

	mock := dbtest.NewMockPool(t)

	restore(t, &DBQueriesGetter)
	DBQueriesGetter = func(context.Context) (*db.Queries, error) { return db.New(mock), nil }

	userID := int32(90)
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, false))
	mock.ExpectQuery(`SELECT .* FROM memories`).WithArgs(userID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at",
		}))

	accessToken, err := crypto.Encrypt("access-token")
	require.NoError(t, err)
	refreshToken, err := crypto.Encrypt("refresh-token")
	require.NoError(t, err)
	tokenType := "Bearer"
	mock.ExpectQuery(`SELECT .* FROM accounts`).WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()).
			AddRow("acc-gdrive-1", userID, "oauth", "google-drive", "acct-1", &refreshToken, &accessToken, nil, &tokenType, nil, nil, nil).
			AddRow("acc-gdrive-2", userID, "oauth", "google-drive", "acct-2", &refreshToken, &accessToken, nil, &tokenType, nil, nil, nil))

	ctx, err := loadRunUserContext(context.Background(), UserContextLoadInput{UserID: userID})
	require.NoError(t, err)
	assert.NotNil(t, ctx.DriveClient)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadRunUserContext_IgnoresStaleSecuritySettingsCache(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mockRedis := withMockRedis(t)
	withDBQueries(t, db.New(mock))

	freshMemory := false
	freshTrustLayer := false
	freshWebSearch := true
	freshCodeExecution := true
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int32(9)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 9, Email: "user@example.com", Plan: "pro",
			Memory: &freshMemory, TrustLayer: &freshTrustLayer,
			WebSearch: &freshWebSearch, CodeExecution: &freshCodeExecution,
		}))
	mock.ExpectQuery(`SELECT .* FROM accounts`).WithArgs(int32(9)).WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()))

	cached := userContextUserRow{
		ID:                   9,
		Plan:                 "enterprise",
		MemoryEnabled:        false,
		TrustLayerEnabled:    true,
		WebSearchEnabled:     false,
		CodeExecutionEnabled: false,
	}
	payload, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(context.Background(), "user_settings:9", payload, time.Minute))

	ctx, err := loadRunUserContext(context.Background(), UserContextLoadInput{UserID: 9})
	require.NoError(t, err)
	assert.Equal(t, "pro", ctx.UserPlan)
	assert.False(t, ctx.MemoryEnabled)
	assert.False(t, ctx.TrustLayerEnabled)
	assert.True(t, ctx.WebSearchEnabled)
	assert.True(t, ctx.CodeExecutionEnabled)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMarshalOrchestrationTrace_DefaultUsesJSON(t *testing.T) {
	data, err := marshalOrchestrationTrace(&orchestrator.OrchestrationTrace{OriginalQuery: "hello"})
	require.NoError(t, err)
	assert.Contains(t, string(data), "hello")
	_ = json.Unmarshal
}

func TestOrchestratePulseTurn_AdapterFailureSetsIdle(t *testing.T) {
	mockDB, agentID := setupPulseAgentMockStatusOnly(t, "agent-adapter-fail", int32(41))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, errors.New("adapter unavailable")
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:"+agentID)
	require.NoError(t, err)
	assert.Equal(t, "IDLE", status)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_AgentFetchError(t *testing.T) {
	mockDB := dbtest.NewMockPool(t)

	restore(t, &DBQueriesGetter)
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return db.New(mockDB), nil
	}

	mockDB.ExpectQuery(`SELECT .* FROM agents`).WithArgs("missing-agent").WillReturnError(errors.New("agent not found"))
	OrchestratePulseTurn(context.Background(), "missing-agent", "scheduled")
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_ConfigLoadFailureSetsIdle(t *testing.T) {
	mockDB, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create db mock: %v", err)
	}
	defer mockDB.Close()

	q := db.New(mockDB)
	redisClient := redis.NewMockClient()
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs("agent-config-fail").
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				"agent-config-fail", int32(31), "Pulse Agent", nil, nil, nil, true,
				"UTC", "09:00", "17:00", []int32{1, 2, 3}, int32(120),
				ts, ts, "IDLE", ts, ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-config-fail", "BUSY").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int32(31)).
		WillReturnRows(fetchUserContextUserRow(int32(31), false, false))
	mockDB.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(int32(31)).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()))
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-config-fail", "IDLE").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	withDBQueries(t, q)
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return redisClient, nil })
	originalConfig := ConfigLoader
	t.Cleanup(func() { ConfigLoader = originalConfig })
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("config failed")
	}

	OrchestratePulseTurn(context.Background(), "agent-config-fail", "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:agent-config-fail")
	if err != nil {
		t.Fatalf("expected redis status to be set: %v", err)
	}
	if status != "IDLE" {
		t.Fatalf("expected IDLE status after config failure, got %q", status)
	}
	if err := mockDB.ExpectationsWereMet(); err != nil {
		t.Fatalf("db expectations not met: %v", err)
	}
}

type canceledContextPulseStore struct {
	statusContextErr error
	status           string
}

func (s *canceledContextPulseStore) GetAgent(context.Context, string) (pulseAgent, error) {
	return pulseAgent{}, nil
}

func (s *canceledContextPulseStore) UpdateAgentStatus(ctx context.Context, input pulseAgentStatusUpdate) error {
	s.statusContextErr = ctx.Err()
	s.status = input.Status
	return nil
}

func (s *canceledContextPulseStore) UpdateAgentPulseState(context.Context, pulseAgentPulseStateUpdate) error {
	return nil
}

func TestSetPulseAgentIdleDetachesFromCanceledExecutionContext(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return redis.NewMockClient(), nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	store := &canceledContextPulseStore{}

	setPulseAgentIdle(ctx, store, "agent-timeout")

	assert.Equal(t, "IDLE", store.status)
	assert.NoError(t, store.statusContextErr)
}
