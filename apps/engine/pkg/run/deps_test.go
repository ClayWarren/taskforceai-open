package run

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	memoryadapters "github.com/TaskForceAI/adapters/pkg/memories"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/memories"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClientMCPToolIsZero(t *testing.T) {
	if !(ClientMCPTool{}).IsZero() {
		t.Fatal("expected empty tool to be zero")
	}
	if !(ClientMCPTool{ServerName: "server"}).IsZero() {
		t.Fatal("expected missing tool name to be zero")
	}
	if (ClientMCPTool{ServerName: "server", ToolName: "search"}).IsZero() {
		t.Fatal("expected complete tool identity to be non-zero")
	}
}

func TestExtractAndSaveMemories_NilStore(t *testing.T) {
	err := extractAndSaveMemories(context.Background(), nil, coreconfig.Config{}, 1, nil, nil, "prompt", "response")
	if err == nil {
		t.Fatal("expected error when memory store is nil")
	}
	if !strings.Contains(err.Error(), "memory store is nil") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestExtractAndSaveMemories_NonNilStore(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var store memories.MemoryStore = memoryadapters.NewStore(db.New(nil))
	err := extractAndSaveMemories(ctx, store, coreconfig.Config{}, 1, nil, nil, "prompt", "response")
	if err == nil {
		t.Fatal("expected extraction error with canceled context")
	}
}

func TestLoadRunUserContextDefault(t *testing.T) {
	original := LoadRunUserContext
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: []string{"memory"}, DriveClient: nil, ProjectInstructions: "instructions", MemoryEnabled: true, TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: "gh-token"}, nil
	}
	t.Cleanup(func() { LoadRunUserContext = original })

	ctx, err := LoadRunUserContext(context.Background(), UserContextLoadInput{UserID: 42})
	require.NoError(t, err)
	assert.Equal(t, []string{"memory"}, ctx.Memories)
	assert.Equal(t, "instructions", ctx.ProjectInstructions)
	assert.Equal(t, "gh-token", ctx.GithubToken)
	assert.True(t, ctx.MemoryEnabled)
	assert.True(t, ctx.TrustLayerEnabled)
	assert.True(t, ctx.WebSearchEnabled)
	assert.True(t, ctx.CodeExecutionEnabled)
}

func TestSQLCUserContextStoreListUserMemoriesWithOrgError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	store := sqlcUserContextStore{q: db.New(mock)}
	orgID := int32(3)

	mock.ExpectQuery(`SELECT .* FROM memories`).
		WithArgs(int32(9), &orgID).
		WillReturnError(errors.New("org memories failed"))
	_, err := store.ListUserMemoriesWithOrg(context.Background(), memories.GetUserMemoriesWithOrgInput{
		UserID:         9,
		OrganizationID: &orgID,
	})
	require.Error(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSQLCTaskPersistenceStoreUsageNoopRows(t *testing.T) {
	store := sqlcTaskPersistenceStore{q: db.New(nil)}
	require.NoError(t, store.CreateTokenUsage(context.Background(), []sharedusage.TokenUsageRow{}))
	require.NoError(t, store.CreateToolUsage(context.Background(), []sharedusage.ToolUsageRow{}))
	require.NoError(t, store.CreateUsageEvents(context.Background(), []sharedusage.EventRow{}))
}

func TestResetDepsRestoresRunTaskPersistenceTx(t *testing.T) {
	RunTaskPersistenceTx = func(context.Context, func(taskPersistenceStore) error) error {
		return errors.New("stub tx")
	}
	ResetDeps()

	original := taskPersistencePoolGetter
	taskPersistencePoolGetter = func(context.Context) (postgres.Transactor, error) {
		return nil, errors.New("pool down after reset")
	}
	t.Cleanup(func() { taskPersistencePoolGetter = original })

	err := RunTaskPersistenceTx(context.Background(), func(store taskPersistenceStore) error {
		t.Fatal("callback should not run")
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pool down after reset")
}

func TestRunTaskPersistenceTxPoolError(t *testing.T) {
	original := taskPersistencePoolGetter
	taskPersistencePoolGetter = func(context.Context) (postgres.Transactor, error) {
		return nil, errors.New("pool unavailable")
	}
	t.Cleanup(func() { taskPersistencePoolGetter = original })

	err := runTaskPersistenceTx(context.Background(), func(store taskPersistenceStore) error {
		t.Fatal("callback should not run")
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pool unavailable")
}

func TestRunTaskPersistenceTxSuccess(t *testing.T) {
	pool := dbtest.NewMockPool(t)

	pool.ExpectBegin()
	pool.ExpectCommit()

	original := taskPersistencePoolGetter
	taskPersistencePoolGetter = func(context.Context) (postgres.Transactor, error) {
		return pool, nil
	}
	t.Cleanup(func() { taskPersistencePoolGetter = original })

	called := false
	err := runTaskPersistenceTx(context.Background(), func(store taskPersistenceStore) error {
		called = true
		require.NotNil(t, store)
		return nil
	})
	require.NoError(t, err)
	require.True(t, called)
	require.NoError(t, pool.ExpectationsWereMet())
}
