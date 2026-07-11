package run

import (
	"context"
	configpkg "github.com/TaskForceAI/config/pkg"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreplatform "github.com/TaskForceAI/core/pkg/platform"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	appdatabase "github.com/TaskForceAI/go-engine/pkg/database"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	infrasearch "github.com/TaskForceAI/infrastructure/search/pkg"
	"path/filepath"
)

func resetSharedSandboxPool(ctx context.Context) {
	sharedSandboxPoolMu.Lock()
	pool := sharedSandboxPool
	sharedSandboxPool = nil
	sharedSandboxPoolMu.Unlock()

	if pool != nil {
		pool.Close(ctx)
	}
}

func ResetDeps() {
	ConfigLoader = loadCoreConfig
	WebEnvLoader = configpkg.LoadWebEnv
	ModelSelectionResolver = orchestrator.ResolveModelSelection
	RedisClientGetter = redis.GetClient
	DBQueriesGetter = appdatabase.GetQueries
	LoadMemoryStore = loadMemoryStore
	LoadTraceRepository = loadTraceRepository
	RunTaskPersistenceTx = runTaskPersistenceTx
	CacheFactory = nil
	LoadRunUserContext = loadRunUserContext
	ExecutePulseOrchestration = executePulseOrchestration
	FinalizeTask = finalizeTask
	InitOrchestrator = initOrchestrator
	SandboxPoolProvider = getSharedSandboxPool
	PromptProvider = defaultPromptProvider
	coreconfig.SetPromptOverrideProvider(nil)
	coreConfigLoaderSourceMu.Lock()
	coreConfigLoaderSourceInstalled = false
	coreConfigLoaderSourceMu.Unlock()
	coreconfig.SetConfigLoaderSource(nil)
	enginecoreWebFetchSourceMu.Lock()
	enginecoreWebFetchSourceInstalled = false
	enginecoreWebFetchSourceMu.Unlock()
	enginecoretools.SetWebFetchSource(nil)
	enginecoreArchiveWriterMu.Lock()
	enginecoreArchiveWriterInstalled = false
	enginecoreArchiveWriterMu.Unlock()
	enginecoretools.SetArchiveWriter(nil)
	enginecoreChartWriterMu.Lock()
	enginecoreChartWriterInstalled = false
	enginecoreChartWriterMu.Unlock()
	enginecoretools.SetChartWriter(nil)
	enginecoreCSVWriterMu.Lock()
	enginecoreCSVWriterInstalled = false
	enginecoreCSVWriterMu.Unlock()
	enginecoretools.SetCSVWriter(nil)
	enginecoreDocumentWriterMu.Lock()
	enginecoreDocumentWriterInstalled = false
	enginecoreDocumentWriterMu.Unlock()
	enginecoretools.SetDocumentWriter(nil)
	enginecorePDFWriterMu.Lock()
	enginecorePDFWriterInstalled = false
	enginecorePDFWriterMu.Unlock()
	enginecoretools.SetPDFWriter(nil)
	enginecorePresentationWriterMu.Lock()
	enginecorePresentationWriterInstalled = false
	enginecorePresentationWriterMu.Unlock()
	enginecoretools.SetPresentationWriter(nil)
	enginecoreSpreadsheetWriterMu.Lock()
	enginecoreSpreadsheetWriterInstalled = false
	enginecoreSpreadsheetWriterMu.Unlock()
	enginecoretools.SetSpreadsheetWriter(nil)
	enginecoreSiteWriterMu.Lock()
	enginecoreSiteWriterInstalled = false
	enginecoreSiteWriterMu.Unlock()
	enginecoretools.SetSiteWriter(nil)
	enginecore.SetSystemPromptSource(nil)
	enginecore.SetInstructionContextSource(nil)
	enginecore.SetInstructionFileSource(nil)
	enginecoreconfig.SetConfigSource(nil)
	enginecoreutil.SetRuntimeContextSource(nil)
	enginecoreToolRuntimeMu.Lock()
	enginecoreToolRuntimeInstalled = false
	enginecoreToolRuntimeMu.Unlock()
	coretools.SetEngineCoreToolRuntime(nil)
	enginecore.SetSystemEnvironmentSource(nil)
	coreplatform.SetLogger(nil)
	coretools.SetToolPromptProvider(nil)
	ResolveAdapter = resolveAdapter
	ExtractAndSaveMemories = extractAndSaveMemories
	PersistGeneratedFileArtifacts = persistGeneratedFileArtifacts
	taskRegistryRedisClientGetter = redis.GetClient
	registryRedisClientGetterWithRetry = redis.GetClient
	newSearchGateway = infrasearch.NewSearchGateway
	globInstructionPattern = filepath.Glob
	resetSharedSandboxPool(context.Background())
	ExecuteOrchestrateWithTask = (*orchestrator.TaskOrchestrator).OrchestrateWithTask
	ExecuteOrchestrate = (*orchestrator.TaskOrchestrator).Orchestrate
	ExecuteOrchestrateMultimodalWithTask = (*orchestrator.TaskOrchestrator).OrchestrateMultimodalWithTask
	ExecuteOrchestrateMultimodal = (*orchestrator.TaskOrchestrator).OrchestrateMultimodal
	ExecuteResumeOrchestration = (*orchestrator.TaskOrchestrator).ResumeOrchestration
}
