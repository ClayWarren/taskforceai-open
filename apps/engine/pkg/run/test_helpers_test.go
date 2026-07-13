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
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	"github.com/stretchr/testify/require"
)

type approvalSetFailRedis struct {
	*redis.MockClient
}

func (c *approvalSetFailRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if len(key) >= len(approvalDecisionKeyPrefix) && key[:len(approvalDecisionKeyPrefix)] == approvalDecisionKeyPrefix {
		return errors.New("set failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type approvalSetFailClient struct {
	*redis.MockClient
}

func (c *approvalSetFailClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return errors.New("set failed")
}

type stubApprovalClient struct {
	publishedTo    string
	publishedBytes []byte
	publishErr     error
}

func (c *stubApprovalClient) Publish(ctx context.Context, channel string, payload []byte) error {
	c.publishedTo = channel
	c.publishedBytes = payload
	return c.publishErr
}

func setApprovalClientFactoryForTest(t *testing.T, client approvalClient) {
	t.Helper()
	original := getApprovalClient
	getApprovalClient = func() (approvalClient, error) {
		return client, nil
	}
	t.Cleanup(func() {
		getApprovalClient = original
	})
}

func setRedisClientGetterForTest(t *testing.T, getter func() (redis.Cmdable, error)) {
	t.Helper()
	original := RedisClientGetter
	RedisClientGetter = getter
	t.Cleanup(func() {
		RedisClientGetter = original
	})
}

// withMockRedis installs a fresh in-memory mock redis client for the duration of
// the test and returns it. The previous RedisClientGetter is restored on cleanup.
func withMockRedis(t *testing.T) *redis.MockClient {
	t.Helper()
	m := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return m, nil })
	return m
}

// withUnavailableRedis makes RedisClientGetter return the given error (or a nil
// client when err is nil) for the duration of the test.
func withUnavailableRedis(t *testing.T, err error) {
	t.Helper()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return nil, err })
}

// withCacheFactory installs the given CacheFactory for the duration of the test
// and restores the previous one on cleanup.
func withCacheFactory(t *testing.T, factory func(redis.Cmdable) corecache.ICache) {
	t.Helper()
	original := CacheFactory
	CacheFactory = factory
	t.Cleanup(func() { CacheFactory = original })
}

// withDBQueries makes DBQueriesGetter return q for the duration of the test and
// restores the previous getter on cleanup.
func withDBQueries(t *testing.T, q *db.Queries) {
	t.Helper()
	original := DBQueriesGetter
	DBQueriesGetter = func(context.Context) (*db.Queries, error) { return q, nil }
	t.Cleanup(func() { DBQueriesGetter = original })
}

// restore snapshots *target now and restores it on cleanup without changing the
// current value. Same stub caveat as swap.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}

func requireTaskRegistry(t testing.TB) *TaskRegistry {
	t.Helper()
	registry, ok := GetRegistry().(*TaskRegistry)
	require.True(t, ok)
	return registry
}

type delegatingRegistrar struct {
	inner                  TaskRegistrar
	get                    func(string) *TaskState
	update                 func(context.Context, string, TaskStatus, string, string) error
	updateWithConversation func(context.Context, string, TaskStatus, string, string, int32, string) error
	updateProgress         func(string, any, any, *BudgetUsage) error
	heartbeat              func(context.Context, string) error
}

func (r *delegatingRegistrar) Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error {
	return r.inner.Register(taskID, userID, prompt, modelID, opts)
}

func (r *delegatingRegistrar) Get(taskID string) *TaskState {
	if r.get != nil {
		return r.get(taskID)
	}
	return r.inner.Get(taskID)
}

func (r *delegatingRegistrar) MarkStarted(taskID string) bool {
	return r.inner.MarkStarted(taskID)
}

func (r *delegatingRegistrar) MarkStartedWithError(taskID string) (bool, error) {
	return r.inner.MarkStartedWithError(taskID)
}

func (r *delegatingRegistrar) Heartbeat(ctx context.Context, taskID string) error {
	if r.heartbeat != nil {
		return r.heartbeat(ctx, taskID)
	}
	return r.inner.Heartbeat(ctx, taskID)
}

func (r *delegatingRegistrar) Update(ctx context.Context, taskID string, status TaskStatus, result, errStr string) error {
	if r.update != nil {
		return r.update(ctx, taskID, status, result, errStr)
	}
	return r.inner.Update(ctx, taskID, status, result, errStr)
}

func (r *delegatingRegistrar) UpdateWithConversation(ctx context.Context, taskID string, status TaskStatus, result, errStr string, conversationID int32, traceID string) error {
	if r.updateWithConversation != nil {
		return r.updateWithConversation(ctx, taskID, status, result, errStr, conversationID, traceID)
	}
	return r.inner.UpdateWithConversation(ctx, taskID, status, result, errStr, conversationID, traceID)
}

func (r *delegatingRegistrar) UpdateWithApproval(ctx context.Context, taskID string, approval *PendingApproval) error {
	return r.inner.UpdateWithApproval(ctx, taskID, approval)
}

func (r *delegatingRegistrar) ClearApproval(ctx context.Context, taskID string) error {
	return r.inner.ClearApproval(ctx, taskID)
}

func (r *delegatingRegistrar) UpdateProgress(taskID string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error {
	if r.updateProgress != nil {
		return r.updateProgress(taskID, agentStatuses, toolEvents, budgetUsage)
	}
	return r.inner.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage)
}

type xAddFailRedis struct {
	*redis.MockClient
}

func (c *xAddFailRedis) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", errors.New("xadd unavailable")
}

func (c *xAddFailRedis) Incr(ctx context.Context, key string) (int, error) {
	return c.MockClient.Incr(ctx, key)
}

type stubTaskPersistenceStore struct {
	createConversationFunc func(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error)
	createMessageFunc      func(ctx context.Context, input taskMessageCreateInput) error
	createTokenUsageFunc   func(ctx context.Context, rows []sharedusage.TokenUsageRow) error
	createToolUsageFunc    func(ctx context.Context, rows []sharedusage.ToolUsageRow) error
}

func (s *stubTaskPersistenceStore) CreateConversation(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
	if s.createConversationFunc != nil {
		return s.createConversationFunc(ctx, input)
	}
	return taskConversationRecord{}, nil
}

func (s *stubTaskPersistenceStore) CreateMessage(ctx context.Context, input taskMessageCreateInput) error {
	if s.createMessageFunc != nil {
		return s.createMessageFunc(ctx, input)
	}
	return nil
}

func (s *stubTaskPersistenceStore) CreateTokenUsage(ctx context.Context, rows []sharedusage.TokenUsageRow) error {
	if s.createTokenUsageFunc != nil {
		return s.createTokenUsageFunc(ctx, rows)
	}
	return nil
}

func (s *stubTaskPersistenceStore) CreateToolUsage(ctx context.Context, rows []sharedusage.ToolUsageRow) error {
	if s.createToolUsageFunc != nil {
		return s.createToolUsageFunc(ctx, rows)
	}
	return nil
}

func inngestgoEvent(taskID string) inngestgo.GenericEvent[map[string]any] {
	return inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{"taskId": taskID},
	}
}

type stubInngestSender struct {
	id  string
	err error
}

func (s *stubInngestSender) Send(ctx context.Context, event any) (string, error) {
	return s.id, s.err
}

func stubOrchestrateConfigLayer(t *testing.T, mockRedis redis.Cmdable) {
	t.Helper()
	if mockRedis == nil {
		mockRedis = redis.NewMockClient()
	}

	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)
	restore(t, &RedisClientGetter)
	restore(t, &ResolveAdapter)
	// Exec-layer globals are not stubbed here, but tests using this helper
	// often assign them directly with t-capturing closures; snapshot them so
	// restore() rolls those back too instead of leaking into later tests.
	restore(t, &LoadRunUserContext)
	restore(t, &InitOrchestrator)
	restore(t, &FinalizeTask)
	restore(t, &ExecuteOrchestrate)
	restore(t, &ExecuteOrchestrateWithTask)
	restore(t, &ExecuteOrchestrateMultimodal)
	restore(t, &ExecuteOrchestrateMultimodalWithTask)

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
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) { return &configpkg.WebEnv{}, nil }
	RedisClientGetter = func() (redis.Cmdable, error) { return mockRedis, nil }
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return new(llmClientMock), nil
	}
}

func stubOrchestrateDeps(t *testing.T, mockRedis redis.Cmdable) {
	t.Helper()
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)
	restore(t, &RedisClientGetter)
	restore(t, &CacheFactory)
	restore(t, &ResolveAdapter)
	restore(t, &LoadRunUserContext)
	restore(t, &InitOrchestrator)
	restore(t, &FinalizeTask)
	restore(t, &ExecuteOrchestrate)
	restore(t, &ExecuteOrchestrateWithTask)
	restore(t, &ExecuteOrchestrateMultimodal)
	restore(t, &ExecuteOrchestrateMultimodalWithTask)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{BaseURL: "https://ai-gateway.vercel.sh/v1", APIKey: "test-key"},
			Models:  coreconfig.ModelsConfig{Default: "openai/gpt-5.6-sol", Options: []coreconfig.ModelOption{{ID: "openai/gpt-5.6-sol"}}},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		return orchestrator.ModelSelectionResult{
			Config: cfg, SelectedModel: orchestrator.ModelOption{ID: modelID},
			SelectorEnabled: true, Options: []orchestrator.ModelOption{{ID: modelID}},
		}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) { return &configpkg.WebEnv{}, nil }
	RedisClientGetter = func() (redis.Cmdable, error) { return mockRedis, nil }
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return new(llmClientMock), nil
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return newTestOrchestrator(input.LLMAdapter)
	}
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		_ = updateTaskStatusWithLockRetry(ctx, GetRegistry(), taskID, StatusCompleted, result, "")
	}
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
	ExecuteOrchestrateWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
	ExecuteOrchestrateMultimodal = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
	ExecuteOrchestrateMultimodalWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
}
