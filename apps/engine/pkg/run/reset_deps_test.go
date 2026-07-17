package run

import (
	"context"
	"errors"
	configpkg "github.com/TaskForceAI/config/pkg"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreplatform "github.com/TaskForceAI/core/pkg/platform"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	appdatabase "github.com/TaskForceAI/go-engine/pkg/database"
	configadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/config"
	enginecoreadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/enginecore"
	taskregistry "github.com/TaskForceAI/go-engine/pkg/run/internal/taskregistry"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	infrasearch "github.com/TaskForceAI/infrastructure/search/pkg"
	"testing"
)

func TestResetDeps(t *testing.T) {
	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("modified")
	}
	ResetDeps()
}

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
	configadapter.ResetForTest()
	enginecoreadapter.ResetForTest()
	enginecore.SetSystemPromptSource(nil)
	enginecore.SetSystemEnvironmentSource(nil)
	coreplatform.SetLogger(nil)
	coretools.SetToolPromptProvider(nil)
	ResolveAdapter = resolveAdapter
	ExtractAndSaveMemories = extractAndSaveMemories
	PersistGeneratedFileArtifacts = persistGeneratedFileArtifacts
	taskregistry.ResetForTest()
	newSearchGateway = infrasearch.NewSearchGateway
	resetSharedSandboxPool(context.Background())
	ExecuteOrchestrateWithTask = (*orchestrator.TaskOrchestrator).OrchestrateWithTask
	ExecuteOrchestrate = (*orchestrator.TaskOrchestrator).Orchestrate
	ExecuteOrchestrateMultimodalWithTask = (*orchestrator.TaskOrchestrator).OrchestrateMultimodalWithTask
	ExecuteOrchestrateMultimodal = (*orchestrator.TaskOrchestrator).OrchestrateMultimodal
	ExecuteResumeOrchestration = (*orchestrator.TaskOrchestrator).ResumeOrchestration
}
