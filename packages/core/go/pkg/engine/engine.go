package engine

import (
	"context"
	"fmt"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecoreprotocol "github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type Options struct {
	Cwd         string
	Root        string
	IDs         enginecore.IDGenerator
	Permission  enginecoreprotocol.PermissionChecker
	Instruction enginecoreprotocol.InstructionResolver
	Cost        enginecore.CostCalculator
	Provider    enginecore.ProviderResolver
	Store       enginecore.MessageStore
	Status      *enginecore.SessionStatus
	Compaction  *enginecore.Compactor
	Summary     enginecore.SummaryGenerator
}

type Engine struct {
	processor    *enginecore.Processor
	orchestrator *enginecore.Orchestrator
}

func New(opts Options) *Engine {
	processor := enginecore.NewProcessorWithIDs(opts.Cwd, opts.IDs)
	if opts.Permission != nil {
		processor.SetPermissionChecker(opts.Permission)
	}
	if opts.Instruction != nil {
		processor.SetInstructionResolver(opts.Instruction)
	}
	if opts.Cost != nil {
		processor.SetCostCalculator(opts.Cost)
	}
	if opts.Cwd != "" || opts.Root != "" {
		processor.SetPath(opts.Cwd, opts.Root)
	}

	runner := enginecore.NewSessionRunner(processor)
	orch := enginecore.NewOrchestrator(runner, opts.Status, opts.Compaction)
	orch.Store = opts.Store
	orch.IDs = opts.IDs
	orch.Summary = opts.Summary
	orch.Provider = opts.Provider
	if orch.Instructions == (enginecore.InstructionLoader{}) {
		loader := enginecore.InstructionLoader{}
		if opts.Root != "" {
			loader.RootDir = opts.Root
		} else if opts.Cwd != "" {
			loader.RootDir = opts.Cwd
		}
		orch.Instructions = loader
	}

	return &Engine{
		processor:    processor,
		orchestrator: orch,
	}
}

type RunInput struct {
	SessionID   string
	Prompt      string
	Stream      enginecore.Stream
	System      []string
	UserSystem  string
	AgentPrompt string
	Cwd         string
	Root        string
}

func (e *Engine) RunStream(ctx context.Context, input RunInput) (enginecore.Transcript, error) {
	if e == nil || e.orchestrator == nil {
		return enginecore.Transcript{}, fmt.Errorf("engine not initialized")
	}
	opts := enginecore.RunOptions{
		SessionID:   input.SessionID,
		Prompt:      input.Prompt,
		Stream:      input.Stream,
		Cwd:         input.Cwd,
		Root:        input.Root,
		System:      input.System,
		UserSystem:  input.UserSystem,
		AgentPrompt: input.AgentPrompt,
	}
	return e.orchestrator.RunWithContext(ctx, opts)
}
