package run

import (
	"context"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/go-engine/pkg/integrations"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
)

type ResearchWorkflowOption = taskcontract.ResearchWorkflowOption

// OrchestrateTaskOptions round-trips through Redis task state and Inngest
// event payloads. Tags pin the historical field names (Go's defaults when
// the struct was untagged) so persisted state and in-flight events keep
// decoding; do not rename keys without a migration.
type OrchestrateTaskOptions = taskcontract.OrchestrateOptions

// OrchestratorInitInput groups the runtime dependencies and mode flags needed
// to build a task orchestrator.
type OrchestratorInitInput struct {
	Config               coreconfig.Config
	UserID               int
	Cache                corecache.ICache
	Memories             []string
	DriveClient          *integrations.GoogleDriveClient
	ProjectInstructions  string
	ComputerUseEnabled   bool
	GithubToken          string
	LLMAdapter           agent.ILLMClient
	RoleModels           map[string]string
	TraceRepo            *Repository
	AutonomyEnabled      bool
	BudgetUSD            *float64
	QuickModeEnabled     bool
	WebSearchEnabled     bool
	CodeExecutionEnabled bool
	SteeringProvider     orchestrator.SteeringProvider
}

type pulseAgent struct {
	ID            string
	UserID        int32
	ModelID       *string
	CheckInterval int32
}

type pulseAgentStatusUpdate struct {
	ID     string
	Status string
}

type pulseAgentPulseStateUpdate struct {
	ID        string
	LastRunAt time.Time
	NextRunAt time.Time
}

type taskConversationCreateInput struct {
	UserID         int
	OrganizationID *int32
	UserInput      string
	Model          string
	AgentCount     int32
	ProjectID      *int32
}

type taskConversationRecord struct {
	ID int32
}

type taskMessageCreateInput struct {
	MessageID      string
	ConversationID int32
	Role           string
	Content        string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	Trace          []byte
}

type taskPersistenceStore interface {
	CreateConversation(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error)
	CreateMessage(ctx context.Context, input taskMessageCreateInput) error
	CreateTokenUsage(ctx context.Context, rows []sharedusage.TokenUsageRow) error
	CreateToolUsage(ctx context.Context, rows []sharedusage.ToolUsageRow) error
}

type pulseAgentStore interface {
	GetAgent(ctx context.Context, agentID string) (pulseAgent, error)
	UpdateAgentStatus(ctx context.Context, input pulseAgentStatusUpdate) error
	UpdateAgentPulseState(ctx context.Context, input pulseAgentPulseStateUpdate) error
}

// userContextUserRow is cached in Redis; tags pin the historical field
// names so entries written before tagging keep decoding within their TTL.
type userContextUserRow struct {
	ID                   int32  `json:"ID"`
	Plan                 string `json:"Plan"`
	MemoryEnabled        bool   `json:"MemoryEnabled"`
	TrustLayerEnabled    bool   `json:"TrustLayerEnabled"`
	WebSearchEnabled     bool   `json:"WebSearchEnabled"`
	CodeExecutionEnabled bool   `json:"CodeExecutionEnabled"`
}

type userContextMemoryRow struct {
	Content string
}

type userContextAccountRow struct {
	Provider     string
	RefreshToken *string
	AccessToken  *string
	TokenType    *string
}

type projectInstructionsLookupInput struct {
	ID     int32
	UserID int32
	OrgID  *int32
}

type projectInstructionsRow struct {
	CustomInstructions *string
}

type userContextStore interface {
	GetUserSettings(ctx context.Context, userID int32) (userContextUserRow, error)
	ListUserMemories(ctx context.Context, userID int32) ([]userContextMemoryRow, error)
	ListUserMemoriesWithOrg(ctx context.Context, input memories.GetUserMemoriesWithOrgInput) ([]userContextMemoryRow, error)
	ListUserAccounts(ctx context.Context, userID int32) ([]userContextAccountRow, error)
	GetProjectInstructions(ctx context.Context, input projectInstructionsLookupInput) (projectInstructionsRow, error)
}

type orchestrateTaskRunner struct {
	taskID   string
	userID   int
	prompt   string
	modelID  string
	opts     OrchestrateTaskOptions
	registry TaskRegistrar
	taskErr  error
}

type orchestrationPreparation struct {
	cfg                 coreconfig.Config
	attachments         Attachments
	adapter             agent.ILLMClient
	hasAttachments      bool
	cacheInstance       corecache.ICache
	requiresCurrentData bool
	userContext         RunUserContext
	traceRepo           *Repository
	orch                *orchestrator.TaskOrchestrator
}
type taskExecutionInput struct {
	Orchestrator      *orchestrator.TaskOrchestrator
	Prompt            string
	TaskID            string
	TrustUserID       *int32
	TraceRepo         *Repository
	Attachments       Attachments
	HasAttachments    bool
	TrustLayerEnabled bool
}

type mediaGenerationInput struct {
	Adapter        agent.ILLMClient
	ModelID        string
	Prompt         string
	Attachments    Attachments
	HasAttachments bool
}
