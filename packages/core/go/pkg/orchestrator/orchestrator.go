package orchestrator

import (
	"context"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/tools"
)

type contextKey string

const sessionIDKey contextKey = "sessionID"

type TaskOrchestrator struct {
	config          config.Config
	client          agent.ILLMClient
	progressTracker IProgressTracker
	usageTracker    IUsageTracker
	budget          *BudgetManager
	telemetry       ITelemetry
	errorReporter   IErrorReporter
	decomposer      ITaskDecomposer
	cache           cache.ICache
	llmCache        *cache.LLMCache
	registry        *tools.ToolRegistry
	traceRepo       IExecutionTraceRepository
	reportGenerator IReportGenerator
	approvalReg     IApprovalRegistry
	panicReporter   BackgroundPanicReporter
	promptProvider  PromptProvider

	TeamService *TeamService
	TeamInbox   TeamInboxStore

	sessionCancelMu sync.RWMutex
	sessionCancels  map[string]context.CancelFunc

	agentCount           int
	timeout              time.Duration
	silent               bool
	mock                 bool
	namespace            string
	memories             []string
	webSearchEnabled     bool
	codeExecutionEnabled bool
	computerUseEnabled   bool
	googleDriveClient    any
	githubToken          string
	projectInstructions  string
	roleModels           map[string]string

	soulContent  string
	isAutonomous bool
	budgetUSD    *float64
}

const defaultCacheNamespace = "orchestrator"

type OrchestratorDeps struct {
	Client          agent.ILLMClient
	Cache           cache.ICache
	SearchGateway   tools.ISearchGateway
	SandboxPool     *tools.SandboxPool
	Decomposer      ITaskDecomposer
	Budget          *BudgetManager
	Telemetry       ITelemetry
	UsageTracker    IUsageTracker
	ErrorReporter   IErrorReporter
	TeamService     *TeamService
	TeamInbox       TeamInboxStore
	TraceRepo       IExecutionTraceRepository
	ReportGenerator IReportGenerator
	ApprovalReg     IApprovalRegistry
	PanicReporter   BackgroundPanicReporter
	PromptProvider  PromptProvider
}

type OrchestratorOptions struct {
	AgentCount           int
	Silent               bool
	Mock                 bool
	CacheNamespace       string
	Memories             []string
	WebSearchEnabled     bool
	CodeExecutionEnabled bool
	ComputerUseEnabled   bool
	GoogleDriveClient    any
	GithubToken          string
	ProjectInstructions  string
	RoleModels           map[string]string
	IsAutonomous         bool
	BudgetUSD            *float64
	ApprovalRegistry     IApprovalRegistry
}

func New(cfg config.Config, d OrchestratorDeps, opts OrchestratorOptions) *TaskOrchestrator {
	agentCount := opts.AgentCount
	if agentCount <= 0 {
		agentCount = cfg.Orchestrator.ParallelAgents
	}
	if agentCount <= 0 {
		agentCount = 1
	}

	namespace := opts.CacheNamespace
	namespace = resolveCacheNamespace(namespace)

	approvalRegistry := d.ApprovalReg
	if approvalRegistry == nil {
		approvalRegistry = opts.ApprovalRegistry
	}

	promptProvider := normalizePromptProvider(d.PromptProvider)

	var soulContent string
	if opts.IsAutonomous {
		soulContent = loadSoulContentFromProvider(promptProvider)
	}

	usageTracker := d.UsageTracker
	if usageTracker == nil {
		usageTracker = NewUsageTracker()
	}

	var llmCache *cache.LLMCache
	if d.Cache != nil {
		llmCache = cache.NewLLMCache(d.Cache)
	}

	budget := d.Budget
	if budget == nil {
		budget = NewBudgetManager(nil)
	}
	if opts.BudgetUSD != nil {
		budget.SetUSDBudget(opts.BudgetUSD)
	}

	registry := tools.DiscoverTools(cfg, d.SearchGateway, d.Cache, d.SandboxPool, cfg.Orchestrator.EnableLocalFileTools, opts.GithubToken)

	inbox := d.TeamInbox
	if inbox == nil {
		inbox = NewInMemoryTeamInbox()
	}

	orch := &TaskOrchestrator{
		config:               cfg,
		client:               d.Client,
		progressTracker:      NewProgressTracker(),
		usageTracker:         usageTracker,
		budget:               budget,
		telemetry:            d.Telemetry,
		errorReporter:        d.ErrorReporter,
		decomposer:           d.Decomposer,
		cache:                d.Cache,
		llmCache:             llmCache,
		registry:             registry,
		traceRepo:            d.TraceRepo,
		reportGenerator:      d.ReportGenerator,
		approvalReg:          approvalRegistry,
		panicReporter:        d.PanicReporter,
		promptProvider:       promptProvider,
		TeamInbox:            inbox,
		TeamService:          d.TeamService,
		sessionCancels:       make(map[string]context.CancelFunc),
		agentCount:           agentCount,
		timeout:              time.Duration(cfg.Orchestrator.TaskTimeout) * time.Second,
		silent:               opts.Silent,
		mock:                 opts.Mock,
		namespace:            namespace,
		memories:             opts.Memories,
		webSearchEnabled:     opts.WebSearchEnabled,
		codeExecutionEnabled: opts.CodeExecutionEnabled,
		computerUseEnabled:   opts.ComputerUseEnabled,
		googleDriveClient:    opts.GoogleDriveClient,
		githubToken:          opts.GithubToken,
		projectInstructions:  opts.ProjectInstructions,
		roleModels:           opts.RoleModels,
		soulContent:          soulContent,
		isAutonomous:         opts.IsAutonomous,
		budgetUSD:            opts.BudgetUSD,
	}

	if orch.TeamService == nil {
		orch.TeamService = NewTeamService(
			NewInMemTeamStore(),
			inbox,
			&TeamSessionManager{orch: orch},
			&TeamModelProvider{orch: orch},
			NewInMemBus(),
		)
	}

	// Register collaborative tools
	teamTools := NewTeamTools(orch.TeamService)
	teamTools.Register(registry)

	return orch
}

func resolveCacheNamespace(ns string) string {
	normalized := cache.NormalizeNamespace(ns)
	if normalized.Ok {
		return normalized.Value
	}
	return defaultCacheNamespace
}

func (o *TaskOrchestrator) GetClient() agent.ILLMClient {
	return o.client
}

func (o *TaskOrchestrator) OnProgress(l func([]AgentStatusSnapshot)) func() {
	return o.progressTracker.OnUpdate(l)
}

func (o *TaskOrchestrator) OnToolUsage(l func(agent.ToolEvent, []agent.ToolEvent)) func() {
	return o.usageTracker.OnToolUsage(l)
}

func (o *TaskOrchestrator) GetBudgetUsage() BudgetUsage {
	return o.budget.GetUsage().Value
}

func (o *TaskOrchestrator) GetToolUsage() []agent.ToolEvent {
	return o.usageTracker.GetToolUsage()
}

func (o *TaskOrchestrator) GetAgentStatuses() []AgentStatusSnapshot {
	return o.progressTracker.GetAgentStatuses()
}

func (o *TaskOrchestrator) GetAgentCount() int {
	return o.agentCount
}

func (o *TaskOrchestrator) registerSessionCancel(sessionID string, cancel context.CancelFunc) {
	if sessionID == "" || cancel == nil {
		return
	}

	o.sessionCancelMu.Lock()
	defer o.sessionCancelMu.Unlock()
	o.sessionCancels[sessionID] = cancel
}

func (o *TaskOrchestrator) clearSessionCancel(sessionID string) {
	if sessionID == "" {
		return
	}

	o.sessionCancelMu.Lock()
	defer o.sessionCancelMu.Unlock()
	delete(o.sessionCancels, sessionID)
}

func (o *TaskOrchestrator) CancelSessionPrompt(sessionID string) bool {
	if sessionID == "" {
		return false
	}

	o.sessionCancelMu.RLock()
	cancel, ok := o.sessionCancels[sessionID]
	o.sessionCancelMu.RUnlock()
	if !ok || cancel == nil {
		return false
	}

	cancel()
	return true
}

// OrchestrateMultimodal runs orchestration with image content parts.
// The decomposer sees text only; images are forwarded to the first agent to avoid
