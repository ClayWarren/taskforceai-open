package tools

import (
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
)

type ToolRegistry struct {
	tools map[string]ITool
}

func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{
		tools: make(map[string]ITool),
	}
}

func (r *ToolRegistry) Register(t ITool) {
	r.tools[t.Name()] = t
}

func (r *ToolRegistry) Get(name string) (ITool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

func (r *ToolRegistry) All() []ITool {
	res := make([]ITool, 0, len(r.tools))
	for _, t := range r.tools {
		res = append(res, t)
	}
	return res
}

func DiscoverTools(cfg config.Config, gateway ISearchGateway, c cache.ICache, pool *SandboxPool, enableLocalFileTools bool, githubToken ...string) *ToolRegistry {
	registry := NewToolRegistry()

	toolCtx := NewEngineCoreToolContext()
	generatedFileToolCtx := toolCtx
	if !enableLocalFileTools {
		generatedFileToolCtx = NewEngineCoreGeneratedFileToolContext()
	}

	if enableLocalFileTools {
		registry.Register(CreateEngineCoreReadTool(toolCtx))
		registry.Register(CreateEngineCoreWriteTool(toolCtx))
		registry.Register(CreateEngineCoreEditTool(toolCtx))
		registry.Register(CreateEngineCoreGlobTool(toolCtx))
		registry.Register(CreateEngineCoreGrepTool(toolCtx))
	}
	registry.Register(CreateEngineCoreSpreadsheetTool(generatedFileToolCtx))
	registry.Register(CreateEngineCoreDocumentTool(generatedFileToolCtx))
	registry.Register(CreateEngineCorePresentationTool(generatedFileToolCtx))
	registry.Register(CreateEngineCoreArchiveTool(generatedFileToolCtx))
	registry.Register(CreateEngineCoreCSVTool(generatedFileToolCtx))
	registry.Register(CreateEngineCorePDFTool(generatedFileToolCtx))
	registry.Register(CreateEngineCoreChartTool(generatedFileToolCtx))
	registry.Register(CreateEngineCoreSiteTool(generatedFileToolCtx))
	registry.Register(CreateTaskDoneTool())

	if gateway != nil {
		registry.Register(CreateSearchTool(cfg, gateway, c))
	}

	if pool != nil {
		ghToken := ""
		if len(githubToken) > 0 {
			ghToken = githubToken[0]
		}
		registry.Register(CreateCodeExecutionTool(pool, ghToken))
		registry.Register(CreateComputerUseTool(pool))
	}

	return registry
}
