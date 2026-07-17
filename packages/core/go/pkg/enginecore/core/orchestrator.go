package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

type Orchestrator struct {
	Runner       *SessionRunner
	Status       *SessionStatus
	Compaction   *Compactor
	Instructions InstructionLoader
	Store        MessageStore
	IDs          IDGenerator
	Summary      SummaryGenerator
	Provider     ProviderResolver

	planMu     sync.Mutex
	planStores map[string]protocol.PlanStore
}

func NewOrchestrator(runner *SessionRunner, status *SessionStatus, compactor *Compactor) *Orchestrator {
	return &Orchestrator{
		Runner:     runner,
		Status:     status,
		Compaction: compactor,
	}
}

type RunOptions struct {
	SessionID   string
	Stream      Stream
	Prompt      string
	Cwd         string
	Root        string
	System      []string
	UserSystem  string
	AgentPrompt string
}

func (o *Orchestrator) Run(opts RunOptions) (Transcript, error) {
	return o.RunWithContext(context.Background(), opts)
}

func (o *Orchestrator) RunWithContext(ctx context.Context, opts RunOptions) (Transcript, error) { //nolint:contextcheck // Nil is supported for compatibility with Run.
	if ctx == nil {
		ctx = context.Background()
	}
	if o.Status != nil {
		o.Status.Set(opts.SessionID, StatusInfo{Type: StatusBusy})
	}
	defer func() {
		if o.Status != nil {
			o.Status.Set(opts.SessionID, StatusInfo{Type: StatusIdle})
		}
	}()

	// Clone runner and processor to ensure thread-safety
	runner := *o.Runner
	if o.Runner.Processor != nil {
		runner.Processor = o.Runner.Processor.Clone()
		planStore := o.loadPlanStore(opts.SessionID)
		runner.Processor.SetPlanStore(planStore)
		defer o.persistPlanStore(opts.SessionID, planStore)
	}

	if len(runner.System) == 0 && len(opts.System) > 0 {
		runner.System = append([]string{}, opts.System...)
	}
	runner.SessionID = opts.SessionID

	if runner.Processor != nil && (opts.Cwd != "" || opts.Root != "") {
		runner.Processor.SetPath(opts.Cwd, opts.Root)
		runner.Processor.SetInstructionResolver(o.Instructions)
	}
	if o.Provider != nil && runner.Processor != nil {
		model, err := o.Provider.GetModel(protocol.DefaultProviderID, protocol.DefaultModelID)
		if err != nil {
			return Transcript{}, fmt.Errorf("resolve model: %w", err)
		}
		runner.Processor.SetModel(model)
	}

	transcript, err := runner.RunWithContext(ctx, opts.Prompt, opts.Stream)
	if err != nil {
		return Transcript{}, fmt.Errorf("run session: %w", err)
	}
	if o.Store != nil {
		o.ensureMetadata(opts.SessionID, transcript.Messages)
		o.Store.Append(opts.SessionID, transcript.Messages...)
	}
	o.compactStoredMessages(opts.SessionID)
	return transcript, nil
}

func (o *Orchestrator) loadPlanStore(sessionID string) protocol.PlanStore {
	o.planMu.Lock()
	defer o.planMu.Unlock()
	if store := o.planStores[sessionID]; store != nil {
		return store
	}
	return enginecoretools.NewPlanStore()
}

func (o *Orchestrator) persistPlanStore(sessionID string, store protocol.PlanStore) {
	if store == nil {
		return
	}
	o.planMu.Lock()
	defer o.planMu.Unlock()
	if store.IsActive() {
		if o.planStores == nil {
			o.planStores = make(map[string]protocol.PlanStore)
		}
		if o.planStores[sessionID] == nil {
			o.planStores[sessionID] = store
		}
	} else if o.planStores[sessionID] == store {
		delete(o.planStores, sessionID)
	}
}

func (o *Orchestrator) compactStoredMessages(sessionID string) {
	if o.Compaction == nil || o.Store == nil {
		return
	}
	msgs := o.Store.Messages(sessionID)
	if o.Compaction.PruneToolOutputs(msgs) {
		o.Store.Replace(sessionID, msgs)
		o.Compaction.NotifyCompacted(sessionID)
	}
	if o.Summary == nil {
		return
	}
	if compacted, next := o.Compaction.Compact(msgs, o.Summary); compacted {
		o.ensureMetadata(sessionID, next[:1])
		o.Store.Replace(sessionID, next)
		o.Compaction.NotifyCompacted(sessionID)
	}
}

func (o *Orchestrator) ensureMetadata(sessionID string, messages []Message) {
	now := time.Now().UnixMilli()
	for i := range messages {
		if messages[i].Info.SessionID == "" {
			messages[i].Info.SessionID = sessionID
		}
		if messages[i].Info.TimeCreated == 0 {
			messages[i].Info.TimeCreated = now
		}
		if messages[i].Info.ID == "" && o.IDs != nil {
			messages[i].Info.ID = o.IDs.Next("message")
		}
	}
}

type RetryOptions struct {
	MaxAttempts int
	APIError    *APIError
}

func (o *Orchestrator) RunWithRetry(opts RunOptions, retryOpts RetryOptions) (Transcript, error) {
	return o.RunWithRetryContext(context.Background(), opts, retryOpts)
}

func (o *Orchestrator) RunWithRetryContext(ctx context.Context, opts RunOptions, retryOpts RetryOptions) (Transcript, error) {
	if retryOpts.MaxAttempts <= 0 {
		retryOpts.MaxAttempts = 1
	}

	var lastErr error
	for attempt := 1; attempt <= retryOpts.MaxAttempts; attempt++ {
		transcript, err := o.RunWithContext(ctx, opts)
		if err == nil {
			return transcript, nil
		}
		lastErr = err
		if apiErr, ok := errors.AsType[*APIError](err); ok {
			retryOpts.APIError = apiErr
		} else {
			retryOpts.APIError = nil
		}
		msg := Retryable(retryOpts.APIError)
		if msg == "" || attempt == retryOpts.MaxAttempts {
			break
		}
		delay := RetryDelay(attempt, retryOpts.APIError)
		if o.Status != nil {
			o.Status.Set(opts.SessionID, StatusInfo{
				Type:    StatusRetry,
				Attempt: attempt,
				Message: msg,
				Next:    time.Now().Add(time.Duration(delay) * time.Millisecond).UnixMilli(),
			})
		}
		select {
		case <-ctx.Done():
			return Transcript{}, ctx.Err()
		case <-time.After(time.Duration(delay) * time.Millisecond):
		}
	}
	return Transcript{}, lastErr
}
