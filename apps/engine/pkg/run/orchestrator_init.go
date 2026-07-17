package run

import (
	"context"
	"log/slog"
	"os"
	"sync"

	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreplatform "github.com/TaskForceAI/core/pkg/platform"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	daytonaadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/daytona"
	enginecoreadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/enginecore"
	infrasearch "github.com/TaskForceAI/infrastructure/search/pkg"
	loggerenv "github.com/TaskForceAI/logger/pkg/env"
)

var (
	sharedSandboxPoolMu sync.Mutex
	sharedSandboxPool   *coretools.SandboxPool
	newSearchGateway    = infrasearch.NewSearchGateway
)

func getSharedSandboxPool() *coretools.SandboxPool {
	sharedSandboxPoolMu.Lock()
	defer sharedSandboxPoolMu.Unlock()

	if sharedSandboxPool == nil {
		sharedSandboxPool = daytonaadapter.NewSandboxPoolFromEnv()
	}
	return sharedSandboxPool
}

func effectiveRoleModels(input OrchestratorInitInput) map[string]string {
	if input.QuickModeEnabled {
		return nil
	}
	return input.RoleModels
}

type coreSearchGatewayAdapter struct {
	gateway *infrasearch.SearchGateway
}

func (a coreSearchGatewayAdapter) Search(ctx context.Context, params coretools.SearchParams) (*coretools.SearchGatewayResult, error) {
	res, err := a.gateway.Search(ctx, infrasearch.SearchParams{
		Provider:       params.Provider,
		OriginalQuery:  params.OriginalQuery,
		EffectiveQuery: params.EffectiveQuery,
		PrimaryQuery:   params.PrimaryQuery,
		FallbackQuery:  params.FallbackQuery,
		MaxResults:     params.MaxResults,
		UserAgent:      params.UserAgent,
		Tokens:         params.Tokens,
	})
	if err != nil {
		return nil, err
	}
	items := make([]coretools.SearchResultItem, len(res.Results))
	for i, item := range res.Results {
		items[i] = coretools.SearchResultItem{
			Title:   item.Title,
			URL:     item.URL,
			Snippet: item.Snippet,
			Content: item.Content,
		}
	}
	return &coretools.SearchGatewayResult{
		Results:       items,
		ProviderLabel: res.ProviderLabel,
	}, nil
}
func initOrchestrator(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
	webEnv := loadOptionalWebEnv("initOrchestrator", "userId", input.UserID)
	cacheNamespace := runProfileKey(input.UserID, nil)
	if effort := input.Config.Agent.ReasoningEffort; effort != "" {
		cacheNamespace += ":reasoning:" + effort
	}
	promptProvider := PromptProvider()
	coreplatform.SetLogger(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	enginecoreadapter.Install()
	coreconfig.SetPromptOverrideProvider(promptProvider)
	enginecore.SetSystemEnvironmentSource(promptProvider)
	enginecore.SetSystemPromptSource(promptProvider)
	coretools.SetToolPromptProvider(promptProvider)

	searchGateway, searchGatewayErr := newSearchGateway(infrasearch.BraveConfig{
		APIKey: webEnv.BraveSearchAPIKey,
	})
	if searchGatewayErr != nil {
		slog.Warn("[OrchestrateTask] Search gateway initialization failed", "error", searchGatewayErr)
	}
	var coreSearchGateway coretools.ISearchGateway
	if searchGateway != nil {
		coreSearchGateway = coreSearchGatewayAdapter{gateway: searchGateway}
	}

	var llmCache *corecache.LLMCache
	if input.Cache != nil {
		llmCache = corecache.NewLLMCache(input.Cache)
	}

	budget := orchestrator.NewBudgetManager(nil)

	// Quick Mode: skip the decomposer so the task is not split across multiple agents.
	// The orchestrator will run a single agent with full tool access.
	var decomposer orchestrator.ITaskDecomposer
	if !input.QuickModeEnabled {
		decomposer = orchestrator.NewTaskDecomposer(orchestrator.TaskDecomposerDeps{
			Client:         input.LLMAdapter,
			Config:         input.Config,
			Budget:         budget,
			LLMCache:       llmCache,
			CacheNamespace: cacheNamespace,
		})
	}

	reportGen := orchestrator.NewLLMReportGenerator(input.LLMAdapter, input.Config)

	isGenerationModel := isMediaGenerationModelID(input.Config.Gateway.Model)

	opts := orchestrator.OrchestratorOptions{
		Mode:                 input.Mode,
		Memories:             input.Memories,
		WebSearchEnabled:     input.WebSearchEnabled && !isGenerationModel,
		CodeExecutionEnabled: input.CodeExecutionEnabled && !isGenerationModel,
		ComputerUseEnabled:   input.ComputerUseEnabled,
		GoogleDriveClient:    input.DriveClient,
		GithubToken:          input.GithubToken,
		ProjectInstructions:  input.ProjectInstructions,
		RoleModels:           effectiveRoleModels(input),
		CacheNamespace:       cacheNamespace,
		IsAutonomous:         input.AutonomyEnabled,
		BudgetUSD:            input.BudgetUSD,
	}
	if input.QuickModeEnabled {
		// Single agent, no task decomposition — faster but still tool-capable.
		opts.AgentCount = 1
	}

	return orchestrator.New(input.Config, orchestrator.OrchestratorDeps{
		Client:             input.LLMAdapter,
		Cache:              input.Cache,
		SearchGateway:      coreSearchGateway,
		SandboxPool:        SandboxPoolProvider(),
		Decomposer:         decomposer,
		Budget:             budget,
		TeamService:        GetTeamService(),
		TeamSessionManager: GetTeamSessionManager(),
		TeamInbox:          GetTeamInbox(),
		TraceRepo:          input.TraceRepo,
		ReportGenerator:    reportGen,
		PanicReporter:      loggerenv.SentryPanicReporter{},
		PromptProvider:     promptProvider,
		SteeringProvider:   input.SteeringProvider,
	}, opts)
}
