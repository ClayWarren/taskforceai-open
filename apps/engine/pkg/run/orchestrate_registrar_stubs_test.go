package run

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
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

func seedStaleTaskSubmissionIdempotency(t *testing.T, client redis.Cmdable, key, taskID string) {
	t.Helper()
	encoded, err := json.Marshal(taskSubmissionIdempotencyReservation{
		TaskID:    taskID,
		CreatedAt: time.Now().Add(-idempotencyPendingWindow - time.Minute).UnixMilli(),
	})
	require.NoError(t, err)
	require.NoError(t, client.Set(context.Background(), taskSubmissionIdempotencyKey(7, key), encoded, idempotencyTTL))
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

type releaseFailRedis struct {
	*redis.MockClient
}

func (c *releaseFailRedis) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		return false, errors.New("release failed")
	}
	return c.MockClient.Del(ctx, key)
}

type dlqDelFailClient struct {
	*redis.MockClient
}

func (c *dlqDelFailClient) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, dlqFallbackPrefix) {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

type dlqStreamRedisClient struct {
	*redis.MockClient
	messages []goredis.XMessage
}

func (c *dlqStreamRedisClient) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	if len(c.messages) == 0 {
		return nil, errors.New("stream unavailable")
	}
	return c.messages, nil
}

type idempotencyDelFailRedis struct {
	*redis.MockClient
}

func (c *idempotencyDelFailRedis) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

type idempotencyRebindRedis struct {
	*redis.MockClient
	released bool
}

func (c *idempotencyRebindRedis) Del(ctx context.Context, key string) (bool, error) {
	deleted, err := c.MockClient.Del(ctx, key)
	if err != nil {
		return deleted, err
	}
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		c.released = true
		_ = c.Set(ctx, key, []byte("still-gone"), time.Minute)
	}
	return deleted, err
}

type dlqCursorSetFailRedis struct {
	*dlqStreamRedisClient
}

func (c *dlqCursorSetFailRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if key == dlqCursorKey {
		return errors.New("cursor persist failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type captureRegistry struct {
	called bool
	taskID string
	userID int
	prompt string
	model  string
	opts   OrchestrateTaskOptions
	err    error
	tasks  map[string]*TaskState
}

func (r *captureRegistry) Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error {
	r.called = true
	r.taskID = taskID
	r.userID = userID
	r.prompt = prompt
	r.model = modelID
	r.opts = opts
	if r.tasks == nil {
		r.tasks = make(map[string]*TaskState)
	}
	r.tasks[taskID] = &TaskState{
		TaskID:  taskID,
		Status:  StatusProcessing,
		UserID:  userID,
		Prompt:  prompt,
		ModelID: modelID,
		Options: opts,
	}
	return r.err
}

func (r *captureRegistry) Get(taskID string) *TaskState {
	if r.tasks == nil {
		return nil
	}
	return r.tasks[taskID]
}

type captureInngest struct {
	called bool
	event  any
	id     string
	err    error
}

func (i *captureInngest) Send(ctx context.Context, event any) (string, error) {
	i.called = true
	i.event = event
	if i.err != nil {
		return "", i.err
	}
	if i.id == "" {
		return "evt-1", nil
	}
	return i.id, nil
}

type evalResultRedis struct {
	*redis.MockClient
	result any
	err    error
}

func (c *evalResultRedis) SupportsEval() bool {
	return true
}

func (c *evalResultRedis) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if c.err != nil {
		cmd.SetErr(c.err)
		return cmd
	}
	cmd.SetVal(c.result)
	return cmd
}

type updateLockBusyRedis struct {
	*redis.MockClient
}

func (c *updateLockBusyRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:update_lock:") {
		return false, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

type startLockBusyRedis struct {
	*redis.MockClient
}

func (c *startLockBusyRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:start_lock:") {
		return false, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

type taskGetErrorRedis struct {
	*redis.MockClient
}

func (c *taskGetErrorRedis) Get(ctx context.Context, key string) (string, error) {
	if strings.HasPrefix(key, "task:") && !strings.Contains(key, "lock") {
		return "", errors.New("connection reset by peer")
	}
	return c.MockClient.Get(ctx, key)
}

type failingTaskSaveRedis struct {
	*redis.MockClient
}

func (c *failingTaskSaveRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if len(key) >= 5 && key[:5] == "task:" {
		return errors.New("save failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

func setupLuaMiniredis(t *testing.T) *goredis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	client := redis.NewClient(rdb)
	redis.SetClient(client)
	t.Cleanup(func() {
		assert.NoError(t, rdb.Close())
		mr.Close()
		redis.SetClient(redis.NewMockClient())
	})
	return rdb
}

func seedLuaTaskRedis(t *testing.T, rdb *goredis.Client, taskID string, payload any) {
	t.Helper()
	ctx := context.Background()
	switch p := payload.(type) {
	case string:
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, p, time.Hour).Err())
		return
	case []byte:
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, p, time.Hour).Err())
		return
	default:
		data, err := json.Marshal(p)
		require.NoError(t, err)
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, data, time.Hour).Err())
	}
}

func seedLuaProcessingTask(t *testing.T, rdb *goredis.Client, taskID string) {
	t.Helper()
	seedLuaTaskRedis(t, rdb, taskID, &TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UpdatedAt: time.Now().Unix(),
	})
}

type luaUpdateProgressEvalInput struct {
	agentStatuses   string
	toolEvents      string
	budgetUsage     string
	updatedAt       any
	ttlSeconds      *int
	progressVersion any
	shortArgs       bool
}

func runLuaUpdateProgressEval(t *testing.T, rdb *goredis.Client, taskID string, in luaUpdateProgressEvalInput) error {
	t.Helper()
	ctx := context.Background()
	key := "task:" + taskID
	updatedAt := in.updatedAt
	if updatedAt == nil {
		updatedAt = time.Now().Unix()
	}
	if in.shortArgs {
		_, err := rdb.Eval(ctx, updateProgressScript, []string{key}, in.agentStatuses, in.toolEvents, in.budgetUsage, updatedAt).Result()
		return err
	}
	ttl := int(TaskTTL.Seconds())
	if in.ttlSeconds != nil {
		ttl = *in.ttlSeconds
	}
	progressVersion := in.progressVersion
	if progressVersion == nil {
		progressVersion = testProgressVersion()
	}
	_, err := rdb.Eval(
		ctx,
		updateProgressScript,
		[]string{key},
		in.agentStatuses,
		in.toolEvents,
		in.budgetUsage,
		updatedAt,
		ttl,
		progressVersion,
	).Result()
	return err
}

func setupMiniredisRegistry(t testing.TB) (*TaskRegistry, *redis.Client, func()) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	client := redis.NewClient(rdb)
	redis.SetClient(client)
	registry := requireTaskRegistry(t)

	cleanup := func() {
		_ = rdb.Close()
		mr.Close()
		redis.SetClient(redis.NewMockClient())
	}
	return registry, client, cleanup
}

type watchUnavailableClient struct {
	*redis.MockClient
}

func (c *watchUnavailableClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

type watchErrorClient struct {
	*redis.MockClient
	watchErr error
}

func (c *watchErrorClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return c.watchErr
}

type fallbackSetNXClient struct {
	*redis.MockClient
	setNXResult bool
	setNXErr    error
}

func (c *fallbackSetNXClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

func (c *fallbackSetNXClient) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if c.setNXErr != nil {
		return false, c.setNXErr
	}
	return c.setNXResult, nil
}
