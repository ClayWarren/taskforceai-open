package run

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"
)

type pulseSetErrorRedis struct {
	*redis.MockClient
	failAgentStatus bool
}

func (c *pulseSetErrorRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if c.failAgentStatus && key == "agent_status:agent-redis-busy" {
		return errors.New("redis set failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type getOnlyRedis struct {
	*redis.MockClient
}

func (c *getOnlyRedis) Del(ctx context.Context, key string) (bool, error) {
	return false, errors.New("del failed")
}

type delFalseRedis struct {
	*redis.MockClient
}

func (c *delFalseRedis) Del(ctx context.Context, key string) (bool, error) {
	return false, nil
}

func setupPulseAgentMockStatusOnly(t *testing.T, agentID string, userID int32) (pgxmock.PgxPoolIface, string) {
	t.Helper()
	mockDB, err := pgxmock.NewPool()
	require.NoError(t, err)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs(agentID).
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				agentID, userID, "Pulse Agent", nil, nil, nil, true,
				"UTC", "09:00", "17:00", []int32{1}, int32(60),
				ts, ts, "IDLE", ts, ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "BUSY").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "IDLE").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	return mockDB, agentID
}

func setupPulseAgentMock(t *testing.T, agentID string, userID int32) (pgxmock.PgxPoolIface, string) {
	t.Helper()
	mockDB, err := pgxmock.NewPool()
	require.NoError(t, err)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs(agentID).
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				agentID, userID, "Pulse Agent", nil, nil, nil, true,
				"UTC", "09:00", "17:00", []int32{1}, int32(60),
				ts, ts, "IDLE", ts, ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "BUSY").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "IDLE").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	return mockDB, agentID
}

func stubPulseDeps(t *testing.T, mockDB pgxmock.PgxPoolIface, redisClient redis.Cmdable) {
	t.Helper()
	q := db.New(mockDB)
	restore(t, &DBQueriesGetter)
	restore(t, &RedisClientGetter)
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)
	restore(t, &ResolveAdapter)
	restore(t, &LoadRunUserContext)
	restore(t, &InitOrchestrator)
	restore(t, &ExecutePulseOrchestration)
	restore(t, &FinalizeTask)

	DBQueriesGetter = func(context.Context) (*db.Queries, error) { return q, nil }
	RedisClientGetter = func() (redis.Cmdable, error) { return redisClient, nil }
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{BaseURL: "https://ai-gateway.vercel.sh/v1", APIKey: "test-key"},
			Models:  coreconfig.ModelsConfig{Default: "openai/gpt-5.6-sol", Options: []coreconfig.ModelOption{{ID: "openai/gpt-5.6-sol"}}},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		return orchestrator.ModelSelectionResult{
			Config:          cfg,
			SelectedModel:   orchestrator.ModelOption{ID: modelID},
			SelectorEnabled: true,
			Options:         []orchestrator.ModelOption{{ID: modelID}},
		}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, nil
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{WebSearchEnabled: true, CodeExecutionEnabled: true}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return &orchestrator.TaskOrchestrator{}
	}
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("pulse execution failed")
	}
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	}
}

type redisGetFailClient struct {
	*redis.MockClient
}

func (c *redisGetFailClient) Get(ctx context.Context, key string) (string, error) {
	return "", errors.New("redis get failed")
}

type redisDelFailClient struct {
	*redis.MockClient
}

func (c *redisDelFailClient) Del(ctx context.Context, key string) (bool, error) {
	return false, errors.New("redis del failed")
}
