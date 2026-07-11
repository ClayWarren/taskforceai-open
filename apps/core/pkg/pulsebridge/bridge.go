package pulsebridge

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/pulse"
)

// Redis matches the interface needed for status checks.
type Redis interface {
	Get(ctx context.Context, key string) (string, error)
}

// DB matches the interface needed from our sqlc generated code.
type DB interface {
	ListEnabledAgents(ctx context.Context) ([]AgentRecord, error)
	ListAgentsDueForPulse(ctx context.Context) ([]AgentRecord, error)
	ClaimAgentPulse(ctx context.Context, input ClaimAgentPulseInput) (bool, error)
	UpdateAgentPulseState(ctx context.Context, input UpdateAgentPulseStateInput) error
	UpdateAgentStatus(ctx context.Context, input UpdateAgentStatusInput) error
}

type AgentRecord struct {
	ID            string
	Timezone      string
	ActiveStart   string
	ActiveEnd     string
	ActiveDays    []int32
	CheckInterval int32
	LastRunAt     pgtype.Timestamp
	NextRunAt     pgtype.Timestamp
}

type UpdateAgentPulseStateInput struct {
	ID        string
	LastRunAt pgtype.Timestamp
	NextRunAt pgtype.Timestamp
}

type ClaimAgentPulseInput struct {
	ID        string
	NextRunAt pgtype.Timestamp
	DueBefore pgtype.Timestamp
}

type UpdateAgentStatusInput struct {
	ID     string
	Status string
}

var resyncInterval = 5 * time.Minute

// Bridge manages the integration between the database and the pulse runner.
type Bridge struct {
	db      DB
	redis   Redis
	runner  *pulse.Runner
	trigger pulse.InteractionTrigger
	ctx     context.Context //nolint:containedctx // Bridge owns this lifecycle context and cancels it in Stop.
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// NewBridgeWithRedis creates a new pulse bridge with optional redis for status checks.
func NewBridgeWithRedis(parentCtx context.Context, db DB, redis Redis, engineURL, engineToken string) *Bridge { //nolint:contextcheck // Nil is a supported compatibility fallback.
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(parentCtx)
	b := &Bridge{
		db:     db,
		redis:  redis,
		ctx:    ctx,
		cancel: cancel,
	}

	// Use the built-in HTTP trigger to call the engine API.
	// This wakes up the agent and allows it to run its autonomy loop.
	// Pass the bridge context so triggers are cancelled on shutdown.
	trigger := NewHTTPTrigger(ctx, engineURL, engineToken)
	b.trigger = trigger
	b.runner = pulse.NewRunner(trigger, b.statusCheck, pulse.NewEventStore())

	return b
}

// Start begins the background scheduling loop and hydrates the initial state.
func (b *Bridge) Start() error {
	// If we are running in a serverless environment (like Vercel), we should
	// skip starting the background runner.
	if os.Getenv("VERCEL") == "1" {
		slog.Info("PulseBridge: skipping background runner in Vercel environment")
		return nil
	}

	// 1. Initial hydration
	if err := b.Sync(); err != nil {
		return err
	}

	// 2. Start the pulse runner
	b.runner.Start()

	// 3. Start a background re-sync ticker (every 5 minutes)
	b.wg.Add(1)
	handler.Go("pulseBridgeResync", func() {
		defer b.wg.Done()
		ticker := time.NewTicker(resyncInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := b.Sync(); err != nil {
					slog.Warn("PulseBridge: background re-sync failed", "error", err)
				}
			case <-b.ctx.Done():
				return
			}
		}
	})

	return nil
}

// Sync hydrates the runner with enabled agents from the database.
func (b *Bridge) Sync() error {
	agents, err := b.db.ListEnabledAgents(b.ctx)
	if err != nil {
		slog.Warn("PulseBridge: failed to sync agents from DB", "error", err)
		return err
	}

	// Build a set of enabled agent IDs for fast lookup.
	enabledIDs := make(map[string]struct{}, len(agents))
	for _, a := range agents {
		enabledIDs[a.ID] = struct{}{}
		b.RegisterAgent(a)
	}

	// Remove any runners whose agents are no longer enabled.
	for _, id := range b.runner.AgentIDs() {
		if _, ok := enabledIDs[id]; !ok {
			b.UnregisterAgent(id)
		}
	}

	return nil
}

// Stop halts the bridge and the runner, waiting for all goroutines to finish.
func (b *Bridge) Stop() {
	if b.cancel != nil {
		b.cancel()
	}
	b.wg.Wait()
	if b.runner != nil {
		b.runner.Stop()
	}
}

// RegisterAgent adds or updates an agent in the pulse runner.
func (b *Bridge) RegisterAgent(a AgentRecord) {
	active := &pulse.ActiveHours{
		Timezone: a.Timezone,
		Start:    a.ActiveStart,
		End:      a.ActiveEnd,
		Days:     a.ActiveDays,
	}

	interval := time.Duration(a.CheckInterval) * time.Second
	lastRun := time.Time{}
	if a.LastRunAt.Valid {
		lastRun = a.LastRunAt.Time
	}
	nextDue := time.Time{}
	if a.NextRunAt.Valid {
		nextDue = a.NextRunAt.Time
	}
	b.runner.UpsertAgentState(a.ID, interval, active, lastRun, nextDue)

	slog.Info("PulseBridge: registered agent", "agentId", a.ID, "autonomyEnabled", true)
}

// UnregisterAgent removes an agent from the pulse runner.
func (b *Bridge) UnregisterAgent(agentID string) {
	b.runner.RemoveAgent(agentID)
	slog.Info("PulseBridge: unregistered agent", "agentId", agentID)
}

// statusCheck implements pulse.StatusChecker by checking the current agent status in Redis or DB.
func (b *Bridge) statusCheck(agentID string) bool {
	if b.redis != nil {
		// Use a fast path if redis is available
		status, err := b.redis.Get(b.ctx, "agent_status:"+agentID)
		if err == nil && status == "BUSY" {
			return true
		}
	}

	// For now, if no redis, we don't want to block heartbeats with DB calls
	// in every tick (10s). The engine will handle concurrency.
	// But let's at least leave the hook ready.
	return false
}

// CronTick is the serverless-safe alternative to the background runner.
// It queries the DB for agents due for a pulse, checks active hours and
// busy status, fires heartbeats, and persists the updated schedule back
// to the DB. Designed to be called from a Vercel Cron endpoint.
func (b *Bridge) CronTick(ctx context.Context) error {
	agents, err := b.db.ListAgentsDueForPulse(ctx)
	if err != nil {
		return fmt.Errorf("PulseBridge cron: failed to list agents due: %w", err)
	}

	now := time.Now()
	sem := make(chan struct{}, 10)
	var wg sync.WaitGroup
	var (
		errMu    sync.Mutex
		runErrs  []error
		enqueued int
	)

	for _, agent := range agents {
		active := &pulse.ActiveHours{
			Timezone: agent.Timezone,
			Start:    agent.ActiveStart,
			End:      agent.ActiveEnd,
			Days:     agent.ActiveDays,
		}
		if !pulse.IsWithinActiveHours(now, active) {
			continue
		}
		if b.statusCheck(agent.ID) {
			slog.Info("PulseBridge cron: agent busy, skipping", "agentId", agent.ID)
			continue
		}

		wg.Add(1)
		enqueued++
		handler.Go("pulseHeartbeat_"+agent.ID, func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			nextRun := now.Add(time.Duration(agent.CheckInterval) * time.Second)
			claimed, err := b.db.ClaimAgentPulse(b.ctx, ClaimAgentPulseInput{
				ID:        agent.ID,
				NextRunAt: pgtype.Timestamp{Time: nextRun, Valid: true},
				DueBefore: pgtype.Timestamp{Time: now, Valid: true},
			})
			if err != nil {
				slog.Warn("PulseBridge cron: failed to claim due agent", "agentId", agent.ID, "error", err)
				errMu.Lock()
				runErrs = append(runErrs, fmt.Errorf("claim %s: %w", agent.ID, err))
				errMu.Unlock()
				return
			}
			if !claimed {
				slog.Info("PulseBridge cron: due agent already claimed", "agentId", agent.ID)
				return
			}

			slog.Info("PulseBridge cron: triggering heartbeat", "agentId", agent.ID)
			if err := b.trigger(agent.ID, "heartbeat"); err != nil {
				slog.Warn("PulseBridge cron: heartbeat trigger failed", "agentId", agent.ID, "error", err)
				errMu.Lock()
				runErrs = append(runErrs, fmt.Errorf("trigger %s: %w", agent.ID, err))
				errMu.Unlock()
				return
			}

			// Use bridge lifetime context so persistence remains consistent with
			// the successful claim even if the incoming HTTP request is canceled.
			if err := b.db.UpdateAgentPulseState(b.ctx, UpdateAgentPulseStateInput{
				ID:        agent.ID,
				LastRunAt: pgtype.Timestamp{Time: now, Valid: true},
				NextRunAt: pgtype.Timestamp{Time: nextRun, Valid: true},
			}); err != nil {
				slog.Warn("PulseBridge cron: failed to update pulse state", "agentId", agent.ID, "error", err)
				errMu.Lock()
				runErrs = append(runErrs, fmt.Errorf("persist %s: %w", agent.ID, err))
				errMu.Unlock()
			}
		})
	}

	wg.Wait()
	if len(runErrs) > 0 {
		return fmt.Errorf("PulseBridge cron: %d/%d heartbeat operations failed: %w", len(runErrs), enqueued, errors.Join(runErrs...))
	}
	return nil
}

// Runner returns the underlying pulse runner.
func (b *Bridge) Runner() *pulse.Runner {
	return b.runner
}
