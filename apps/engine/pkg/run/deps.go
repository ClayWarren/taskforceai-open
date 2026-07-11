package run

import (
	"context"
	"fmt"
	appdatabase "github.com/TaskForceAI/go-engine/pkg/database"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"strconv"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/go-engine/pkg/integrations"
	llmpkg "github.com/TaskForceAI/infrastructure/llm/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Injectable dependencies for testing

// ConfigLoader loads configuration
var ConfigLoader = loadCoreConfig

// WebEnvLoader loads web environment
var WebEnvLoader = configpkg.LoadWebEnv

// ModelSelectionResolver resolves model selection
var ModelSelectionResolver = orchestrator.ResolveModelSelection

// RedisClientGetter gets the redis client
var RedisClientGetter = redis.GetClient

// DBQueriesGetter gets database queries
var DBQueriesGetter = appdatabase.GetQueries

// LoadMemoryStore loads the memory persistence store.
var LoadMemoryStore = loadMemoryStore

// LoadTraceRepository loads the execution trace repository.
var LoadTraceRepository = loadTraceRepository

// RunTaskPersistenceTx executes task persistence inside a transaction.
var RunTaskPersistenceTx = runTaskPersistenceTx

// CacheFactory creates a cache instance from redis client
var CacheFactory func(client redis.Cmdable) corecache.ICache

// LoadRunUserContext loads typed user context dependencies for orchestration.
var LoadRunUserContext = loadRunUserContext

// ExecutePulseOrchestration runs the pulse orchestration call.
var ExecutePulseOrchestration = executePulseOrchestration

// FinalizeTask persists task completion and side effects.
var FinalizeTask = finalizeTask

// InitOrchestrator builds the task orchestrator.
var InitOrchestrator = initOrchestrator

// SandboxPoolProvider returns the process-wide Daytona sandbox pool.
var SandboxPoolProvider = getSharedSandboxPool

type CorePromptProvider interface {
	orchestrator.PromptProvider
	coreconfig.PromptOverrideProvider
	enginecore.SystemEnvironmentSource
	enginecore.SystemPromptSource
}

func defaultPromptProvider() CorePromptProvider {
	return newCorePromptProviderFromEnv()
}

// PromptProvider returns core prompt text from engine-owned configuration details.
var PromptProvider = defaultPromptProvider

// ResolveAdapter resolves an LLM adapter for the selected model.
var ResolveAdapter = resolveAdapter

// ExtractAndSaveMemories runs memory extraction and persistence.
var ExtractAndSaveMemories = extractAndSaveMemories

// PersistGeneratedFileArtifacts uploads generated tool artifacts into developer file storage.
var PersistGeneratedFileArtifacts = persistGeneratedFileArtifacts

// Function type aliases for test dependency injection.
type UserContextLoadInput struct {
	UserID    int32
	ProjectID *int32
	OrgID     *int32
}

type RunUserContext struct {
	Memories             []string
	DriveClient          *integrations.GoogleDriveClient
	ProjectInstructions  string
	GithubToken          string
	UserPlan             string
	MemoryEnabled        bool
	TrustLayerEnabled    bool
	WebSearchEnabled     bool
	CodeExecutionEnabled bool
}

type memoryStoreAdapter struct {
	q *db.Queries
}

type sqlcPulseAgentStore struct {
	q *db.Queries
}

type sqlcUserContextStore struct {
	q *db.Queries
}

type sqlcTaskPersistenceStore struct {
	q *db.Queries
}

var ExecuteOrchestrateWithTask = (*orchestrator.TaskOrchestrator).OrchestrateWithTask

var ExecuteOrchestrate = (*orchestrator.TaskOrchestrator).Orchestrate

var ExecuteOrchestrateMultimodalWithTask = (*orchestrator.TaskOrchestrator).OrchestrateMultimodalWithTask

var ExecuteOrchestrateMultimodal = (*orchestrator.TaskOrchestrator).OrchestrateMultimodal

var ExecuteResumeOrchestration = (*orchestrator.TaskOrchestrator).ResumeOrchestration

func loadMemoryStore(ctx context.Context) (memories.MemoryStore, error) {
	return loadFromQueries(ctx, func(q *db.Queries) memories.MemoryStore { return memoryStoreAdapter{q: q} })
}

func loadPulseAgentStore(ctx context.Context) (pulseAgentStore, error) {
	return loadFromQueries(ctx, func(q *db.Queries) pulseAgentStore { return sqlcPulseAgentStore{q: q} })
}

func loadUserContextStore(ctx context.Context) (userContextStore, error) {
	return loadFromQueries(ctx, func(q *db.Queries) userContextStore { return sqlcUserContextStore{q: q} })
}

func loadTraceRepository(ctx context.Context) (*Repository, error) {
	return loadFromQueries(ctx, NewRepositoryFromQueries)
}

func loadFromQueries[T any](ctx context.Context, build func(*db.Queries) T) (T, error) {
	q, err := DBQueriesGetter(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	return build(q), nil
}

var taskPersistencePoolGetter = func(ctx context.Context) (postgres.Transactor, error) {
	return postgres.GetPool(ctx)
}

func runTaskPersistenceTx(ctx context.Context, fn func(store taskPersistenceStore) error) error {
	p, err := taskPersistencePoolGetter(ctx)
	if err != nil {
		return err
	}
	return postgres.WithTx(ctx, p, func(tx pgx.Tx) error {
		return fn(sqlcTaskPersistenceStore{q: db.New(tx)})
	})
}

func extractAndSaveMemories(ctx context.Context, store memories.MemoryStore, cfg coreconfig.Config, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
	if store == nil {
		return fmt.Errorf("memory store is nil")
	}
	memSvc := memories.NewServiceWithExtractor(store, cfg, extractMemoriesWithGateway)
	return memSvc.ExtractAndSaveMemories(ctx, userID, orgID, sourceConversationID, userPrompt, assistantResponse)
}

func extractMemoriesWithGateway(ctx context.Context, cfg coreconfig.Config, extractionPrompt string) (string, error) {
	cfg.SystemPrompt = "You are a memory extraction assistant. Your job is to identify and summarize key information about a user to improve future interactions."
	cfg.Agent.MaxIterations = 1
	client := llmpkg.NewOpenAIAdapter(cfg)
	temperature := 0.1
	a := agent.NewGatewayAgent(cfg, client, agent.AgentOptions{
		RawSystemPrompt: true,
		Temperature:     &temperature,
	})
	return a.Run(ctx, extractionPrompt, nil)
}

func (a memoryStoreAdapter) GetUserMemories(ctx context.Context, userID int32) ([]memories.MemoryRecord, error) {
	rows, err := a.q.GetUserMemories(ctx, userID)
	if err != nil {
		return nil, err
	}
	return memoryRecordsFromRows(rows), nil
}

func (a memoryStoreAdapter) GetUserMemoriesWithOrg(ctx context.Context, input memories.GetUserMemoriesWithOrgInput) ([]memories.MemoryRecord, error) {
	rows, err := a.q.GetUserMemoriesWithOrg(ctx, db.GetUserMemoriesWithOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	return memoryRecordsFromRows(rows), nil
}

func memoryRecordsFromRows(rows []db.Memory) []memories.MemoryRecord {
	records := make([]memories.MemoryRecord, len(rows))
	for i, row := range rows {
		records[i] = memoryRecordFromRow(row)
	}
	return records
}

func memoryRecordFromRow(row db.Memory) memories.MemoryRecord {
	return memories.MemoryRecord{
		ID:             row.ID,
		UserID:         row.UserID,
		OrganizationID: row.OrganizationID,
		Content:        row.Content,
		Type:           row.Type,
		Metadata:       row.Metadata,
		CreatedAt:      memoryTimestampString(row.CreatedAt),
		UpdatedAt:      memoryTimestampString(row.UpdatedAt),
	}
}

func (a memoryStoreAdapter) DeleteMemory(ctx context.Context, input memories.DeleteMemoryInput) error {
	return a.q.DeleteMemory(ctx, db.DeleteMemoryParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
}

func (a memoryStoreAdapter) DeleteMemoryWithOrg(ctx context.Context, input memories.DeleteMemoryWithOrgInput) error {
	return a.q.DeleteMemoryWithOrg(ctx, db.DeleteMemoryWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (a memoryStoreAdapter) CreateMemory(ctx context.Context, input memories.CreateMemoryInput) error {
	_, err := a.q.CreateMemory(ctx, db.CreateMemoryParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Content:        input.Content,
		Type:           input.Type,
		Metadata:       input.Metadata,
	})
	return err
}

func (a memoryStoreAdapter) UpdateMemory(ctx context.Context, input memories.UpdateMemoryStoreInput) (memories.MemoryRecord, error) {
	row, err := a.q.UpdateMemory(ctx, db.UpdateMemoryParams{
		ID:       input.ID,
		UserID:   input.UserID,
		Content:  input.Content,
		Type:     input.Type,
		Metadata: input.Metadata,
	})
	if err != nil {
		return memories.MemoryRecord{}, err
	}
	return mapMemoryRow(row), nil
}

func (a memoryStoreAdapter) UpdateMemoryWithOrg(ctx context.Context, input memories.UpdateMemoryWithOrgStoreInput) (memories.MemoryRecord, error) {
	row, err := a.q.UpdateMemoryWithOrg(ctx, db.UpdateMemoryWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Content:        input.Content,
		Type:           input.Type,
		Metadata:       input.Metadata,
	})
	if err != nil {
		return memories.MemoryRecord{}, err
	}
	return mapMemoryRow(row), nil
}

func memoryTimestampString(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339)
}

func mapMemoryRow(row db.Memory) memories.MemoryRecord {
	return memories.MemoryRecord{
		ID:             row.ID,
		UserID:         row.UserID,
		OrganizationID: row.OrganizationID,
		Content:        row.Content,
		Type:           row.Type,
		Metadata:       row.Metadata,
		CreatedAt:      memoryTimestampString(row.CreatedAt),
		UpdatedAt:      memoryTimestampString(row.UpdatedAt),
	}
}

func (s sqlcPulseAgentStore) GetAgent(ctx context.Context, agentID string) (pulseAgent, error) {
	agentRow, err := s.q.GetAgent(ctx, agentID)
	if err != nil {
		return pulseAgent{}, err
	}
	return pulseAgent{
		ID:            agentRow.ID,
		UserID:        agentRow.UserID,
		ModelID:       agentRow.ModelID,
		CheckInterval: agentRow.CheckInterval,
	}, nil
}

func (s sqlcPulseAgentStore) UpdateAgentStatus(ctx context.Context, input pulseAgentStatusUpdate) error {
	return s.q.UpdateAgentStatus(ctx, db.UpdateAgentStatusParams{
		ID:     input.ID,
		Status: input.Status,
	})
}

func (s sqlcPulseAgentStore) UpdateAgentPulseState(ctx context.Context, input pulseAgentPulseStateUpdate) error {
	return s.q.UpdateAgentPulseState(ctx, db.UpdateAgentPulseStateParams{
		ID:        input.ID,
		LastRunAt: pgtype.Timestamp{Time: input.LastRunAt, Valid: true},
		NextRunAt: pgtype.Timestamp{Time: input.NextRunAt, Valid: true},
	})
}

func (s sqlcTaskPersistenceStore) CreateConversation(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
	userIDText := strconv.Itoa(input.UserID)
	conversation, err := s.q.CreateConversation(ctx, db.CreateConversationParams{
		UserID:         &userIDText,
		OrganizationID: input.OrganizationID,
		UserInput:      input.UserInput,
		Model:          &input.Model,
		AgentCount:     input.AgentCount,
		ProjectID:      input.ProjectID,
	})
	if err != nil {
		return taskConversationRecord{}, err
	}
	return taskConversationRecord{ID: conversation.ID}, nil
}

func (s sqlcTaskPersistenceStore) CreateMessage(ctx context.Context, input taskMessageCreateInput) error {
	_, err := s.q.CreateMessage(ctx, db.CreateMessageParams{
		MessageID:      input.MessageID,
		ConversationID: input.ConversationID,
		Role:           input.Role,
		Content:        input.Content,
		Sources:        input.Sources,
		ToolEvents:     input.ToolEvents,
		AgentStatuses:  input.AgentStatuses,
		Trace:          input.Trace,
	})
	return err
}

func (s sqlcTaskPersistenceStore) CreateTokenUsage(ctx context.Context, rows []sharedusage.TokenUsageRow) error {
	return s.q.CreateTokenUsage(ctx, rows)
}

func (s sqlcTaskPersistenceStore) CreateToolUsage(ctx context.Context, rows []sharedusage.ToolUsageRow) error {
	return s.q.CreateToolUsage(ctx, rows)
}

func (s sqlcUserContextStore) GetUserSettings(ctx context.Context, userID int32) (userContextUserRow, error) {
	dbUser, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return userContextUserRow{}, err
	}
	return userContextUserRow{
		ID:                   dbUser.ID,
		Plan:                 dbUser.Plan,
		MemoryEnabled:        dbUser.MemoryEnabled,
		TrustLayerEnabled:    dbUser.TrustLayerEnabled,
		WebSearchEnabled:     dbUser.WebSearchEnabled,
		CodeExecutionEnabled: dbUser.CodeExecutionEnabled,
	}, nil
}

func (s sqlcUserContextStore) ListUserMemories(ctx context.Context, userID int32) ([]userContextMemoryRow, error) {
	rows, err := s.q.GetUserMemories(ctx, userID)
	if err != nil {
		return nil, err
	}
	records := make([]userContextMemoryRow, len(rows))
	for i, row := range rows {
		records[i] = userContextMemoryRow{Content: row.Content}
	}
	return records, nil
}

func (s sqlcUserContextStore) ListUserMemoriesWithOrg(ctx context.Context, input memories.GetUserMemoriesWithOrgInput) ([]userContextMemoryRow, error) {
	rows, err := s.q.GetUserMemoriesWithOrg(ctx, db.GetUserMemoriesWithOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	records := make([]userContextMemoryRow, len(rows))
	for i, row := range rows {
		records[i] = userContextMemoryRow{Content: row.Content}
	}
	return records, nil
}

func (s sqlcUserContextStore) ListUserAccounts(ctx context.Context, userID int32) ([]userContextAccountRow, error) {
	rows, err := s.q.GetAccountsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	records := make([]userContextAccountRow, len(rows))
	for i, row := range rows {
		records[i] = userContextAccountRow{
			Provider:     row.Provider,
			RefreshToken: row.RefreshToken,
			AccessToken:  row.AccessToken,
			TokenType:    row.TokenType,
		}
	}
	return records, nil
}

func (s sqlcUserContextStore) GetProjectInstructions(ctx context.Context, input projectInstructionsLookupInput) (projectInstructionsRow, error) {
	var (
		project db.Project
		err     error
	)
	if input.OrgID != nil {
		project, err = s.q.GetProjectByUserOrgAndID(ctx, db.GetProjectByUserOrgAndIDParams{
			ID:             input.ID,
			UserID:         input.UserID,
			OrganizationID: input.OrgID,
		})
	} else {
		project, err = s.q.GetProjectByID(ctx, db.GetProjectByIDParams{
			ID:     input.ID,
			UserID: input.UserID,
		})
	}
	if err != nil {
		return projectInstructionsRow{}, err
	}
	return projectInstructionsRow{
		CustomInstructions: project.CustomInstructions,
	}, nil
}
