package handler

import (
	"context"
	"fmt"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/payments"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"github.com/jackc/pgx/v5"
)

type agentStoreAdapter struct {
	q          *db.Queries
	transactor postgres.Transactor
}

const agentQuotaAdvisoryLockNamespace int32 = 0x41474e54

func newAgentStore(q *db.Queries) agentStoreAdapter {
	transactor, _ := q.GetDB().(postgres.Transactor)
	return agentStoreAdapter{q: q, transactor: transactor}
}

func (a agentStoreAdapter) ListAgentsByUserID(ctx context.Context, userID int32) ([]agents.AgentRecord, error) {
	return a.q.ListAgentsByUserID(ctx, userID)
}

func (a agentStoreAdapter) GetAgent(ctx context.Context, agentID string) (agents.AgentRecord, error) {
	return a.q.GetAgent(ctx, agentID)
}

func (a agentStoreAdapter) UpsertAgent(ctx context.Context, input agents.UpsertAgentInput) (agents.AgentRecord, error) {
	if !input.AutonomyEnabled {
		return a.q.UpsertAgent(ctx, input)
	}
	if a.transactor == nil {
		return agents.AgentRecord{}, fmt.Errorf("agent store does not support transactions")
	}

	var saved agents.AgentRecord
	err := postgres.WithTx(ctx, a.transactor, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, $2)", agentQuotaAdvisoryLockNamespace, input.UserID); err != nil {
			return fmt.Errorf("lock agent quota: %w", err)
		}

		var plan string
		if err := tx.QueryRow(ctx, "SELECT plan FROM users WHERE id = $1 FOR UPDATE", input.UserID).Scan(&plan); err != nil {
			return fmt.Errorf("load agent owner plan: %w", err)
		}

		qtx := a.q.WithTx(tx)
		existing, err := qtx.ListAgentsByUserID(ctx, input.UserID)
		if err != nil {
			return fmt.Errorf("load agents for quota: %w", err)
		}

		limit := payments.AgentLimitForPlan(plan)
		enabled := 0
		for _, agent := range existing {
			if agent.ID == input.ID {
				continue
			}
			if agent.AutonomyEnabled {
				enabled++
			}
		}
		if enabled >= limit {
			return &agents.AutonomyLimitError{Limit: limit}
		}

		saved, err = qtx.UpsertAgent(ctx, input)
		return err
	})
	return saved, err
}
