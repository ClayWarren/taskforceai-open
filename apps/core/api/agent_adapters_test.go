package handler

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func adapterColumns(count int) []string {
	columns := make([]string, count)
	for i := range columns {
		columns[i] = fmt.Sprintf("column_%d", i)
	}
	return columns
}

func newAgentAdapterMock(t *testing.T) (agentStoreAdapter, pgxmock.PgxPoolIface) {
	t.Helper()
	pool, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.NoError(t, pool.ExpectationsWereMet())
		pool.Close()
	})
	return newAgentStore(db.New(pool)), pool
}

func TestAgentStoreAdapter_EnforcesAutonomyLimitInsideTransaction(t *testing.T) {
	store, pool := newAgentAdapterMock(t)
	input := agents.UpsertAgentInput{
		ID:              "agent_new",
		UserID:          20,
		Name:            "New agent",
		AutonomyEnabled: true,
		Timezone:        "UTC",
		ActiveStart:     "09:00",
		ActiveEnd:       "17:00",
		ActiveDays:      []int32{1, 2, 3, 4, 5},
		CheckInterval:   600,
		Status:          "IDLE",
	}

	pool.ExpectBegin()
	pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnResult(pgxmock.NewResult("SELECT", 1))
	pool.ExpectQuery("SELECT plan FROM users").WithArgs(int32(20)).WillReturnRows(pgxmock.NewRows([]string{"plan"}).AddRow("pro"))
	pool.ExpectQuery("FROM agents").WithArgs(int32(20)).WillReturnRows(
		pgxmock.NewRows(adapterColumns(len(agentValues()))),
	)
	pool.ExpectQuery("INSERT INTO agents").WithArgs(
		input.ID,
		input.UserID,
		input.Name,
		input.Description,
		input.Avatar,
		input.ModelID,
		input.AutonomyEnabled,
		input.Timezone,
		input.ActiveStart,
		input.ActiveEnd,
		input.ActiveDays,
		input.CheckInterval,
		input.Status,
	).WillReturnRows(
		pgxmock.NewRows(adapterColumns(len(agentValues()))).AddRow(agentValues()...),
	)
	pool.ExpectCommit()

	saved, err := store.UpsertAgent(context.Background(), input)
	require.NoError(t, err)
	assert.Equal(t, "agent_1", saved.ID)
}

func TestAgentStoreAdapter_RollsBackWhenAtomicLimitIsExceeded(t *testing.T) {
	store, pool := newAgentAdapterMock(t)
	input := agents.UpsertAgentInput{ID: "agent_new", UserID: 20, AutonomyEnabled: true}

	pool.ExpectBegin()
	pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnResult(pgxmock.NewResult("SELECT", 1))
	pool.ExpectQuery("SELECT plan FROM users").WithArgs(int32(20)).WillReturnRows(pgxmock.NewRows([]string{"plan"}).AddRow("pro"))
	agentRows := pgxmock.NewRows(adapterColumns(len(agentValues())))
	for range 4 {
		agentRows.AddRow(agentValues()...)
	}
	pool.ExpectQuery("FROM agents").WithArgs(int32(20)).WillReturnRows(agentRows)
	pool.ExpectRollback()

	_, err := store.UpsertAgent(context.Background(), input)
	var limitErr *agents.AutonomyLimitError
	require.ErrorAs(t, err, &limitErr)
	assert.Equal(t, 4, limitErr.Limit)
}

func TestAgentStoreAdapter_RejectsAutonomyWithoutTransactionSupport(t *testing.T) {
	q, _ := newQueuedQueries()
	store := newAgentStore(q)

	_, err := store.UpsertAgent(context.Background(), agents.UpsertAgentInput{AutonomyEnabled: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not support transactions")
}

func TestAgentStoreAdapter_TransactionFailures(t *testing.T) {
	input := agents.UpsertAgentInput{ID: "agent_new", UserID: 20, AutonomyEnabled: true}

	t.Run("advisory lock", func(t *testing.T) {
		store, pool := newAgentAdapterMock(t)
		pool.ExpectBegin()
		pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnError(errors.New("lock failed"))
		pool.ExpectRollback()

		_, err := store.UpsertAgent(context.Background(), input)
		require.ErrorContains(t, err, "lock agent quota")
	})

	t.Run("owner plan", func(t *testing.T) {
		store, pool := newAgentAdapterMock(t)
		pool.ExpectBegin()
		pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnResult(pgxmock.NewResult("SELECT", 1))
		pool.ExpectQuery("SELECT plan FROM users").WithArgs(int32(20)).WillReturnError(errors.New("plan failed"))
		pool.ExpectRollback()

		_, err := store.UpsertAgent(context.Background(), input)
		require.ErrorContains(t, err, "load agent owner plan")
	})

	t.Run("existing agents", func(t *testing.T) {
		store, pool := newAgentAdapterMock(t)
		pool.ExpectBegin()
		pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnResult(pgxmock.NewResult("SELECT", 1))
		pool.ExpectQuery("SELECT plan FROM users").WithArgs(int32(20)).WillReturnRows(pgxmock.NewRows([]string{"plan"}).AddRow("pro"))
		pool.ExpectQuery("FROM agents").WithArgs(int32(20)).WillReturnError(errors.New("agents failed"))
		pool.ExpectRollback()

		_, err := store.UpsertAgent(context.Background(), input)
		require.ErrorContains(t, err, "load agents for quota")
	})
}

func TestAgentStoreAdapter_DoesNotCountTheUpdatedAgentAgainstItsOwnLimit(t *testing.T) {
	store, pool := newAgentAdapterMock(t)
	input := agents.UpsertAgentInput{ID: "agent_1", UserID: 20, AutonomyEnabled: true}

	pool.ExpectBegin()
	pool.ExpectExec("SELECT pg_advisory_xact_lock").WithArgs(agentQuotaAdvisoryLockNamespace, int32(20)).WillReturnResult(pgxmock.NewResult("SELECT", 1))
	pool.ExpectQuery("SELECT plan FROM users").WithArgs(int32(20)).WillReturnRows(pgxmock.NewRows([]string{"plan"}).AddRow("free"))
	pool.ExpectQuery("FROM agents").WithArgs(int32(20)).WillReturnRows(
		pgxmock.NewRows(adapterColumns(len(agentValues()))).AddRow(agentValues()...),
	)
	pool.ExpectQuery("INSERT INTO agents").WithArgs(
		input.ID,
		input.UserID,
		input.Name,
		input.Description,
		input.Avatar,
		input.ModelID,
		input.AutonomyEnabled,
		input.Timezone,
		input.ActiveStart,
		input.ActiveEnd,
		input.ActiveDays,
		input.CheckInterval,
		input.Status,
	).WillReturnRows(
		pgxmock.NewRows(adapterColumns(len(agentValues()))).AddRow(agentValues()...),
	)
	pool.ExpectCommit()

	_, err := store.UpsertAgent(context.Background(), input)
	require.NoError(t, err)
}
