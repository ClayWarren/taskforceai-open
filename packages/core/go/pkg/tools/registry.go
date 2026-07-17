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
		registry.Register(CreateEngineCoreApplyPatchTool(toolCtx))
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
	registry.Register(CreateSkillTool(nil))

	if gateway != nil {
		registry.Register(CreateSearchTool(cfg, gateway, c))
	}

	if pool != nil {
		// Keep the optional argument for source compatibility, but never pass
		// user OAuth credentials into model-controlled sandbox tools.
		_ = githubToken
		registry.Register(CreateCodeExecutionTool(pool))
		registry.Register(CreateComputerUseTool(pool))

		// Prefer the sandbox-backed file tools over the static local ones
		// above: apps/engine has no real local filesystem of its own, so a
		// live cloud sandbox is the correct home for read/write/edit/
		// apply_patch whenever one is configured.
		registry.Register(CreateSandboxReadTool(pool))
		registry.Register(CreateSandboxWriteTool(pool))
		registry.Register(CreateSandboxEditTool(pool))
		registry.Register(CreateSandboxApplyPatchTool(pool))
	}

	return registry
}
