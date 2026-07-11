package run

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/memories"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
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

	var store memories.MemoryStore = memoryStoreAdapter{q: db.New(nil)}
	err := extractAndSaveMemories(ctx, store, coreconfig.Config{}, 1, nil, nil, "prompt", "response")
	if err == nil {
		t.Fatal("expected extraction error with canceled context")
	}
}

func memoryRows() *pgxmock.Rows {
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	orgID := int32(7)
	return pgxmock.NewRows([]string{"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at"}).
		AddRow(int32(1), int32(42), &orgID, "remember this", "fact", []byte("{}"), now, now)
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

func TestMemoryStoreAdapterQueries(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("mock pool: %v", err)
	}
	defer mock.Close()

	store := memoryStoreAdapter{q: db.New(mock)}
	ctx := context.Background()
	orgID := int32(7)

	mock.ExpectQuery("GetUserMemories").WithArgs(int32(42)).WillReturnRows(memoryRows())
	records, err := store.GetUserMemories(ctx, 42)
	if err != nil {
		t.Fatalf("get memories: %v", err)
	}
	if len(records) != 1 || records[0].Content != "remember this" || records[0].Type != "fact" {
		t.Fatalf("unexpected memory records: %#v", records)
	}

	mock.ExpectQuery("GetUserMemoriesWithOrg").WithArgs(int32(42), &orgID).WillReturnRows(memoryRows())
	records, err = store.GetUserMemoriesWithOrg(ctx, memories.GetUserMemoriesWithOrgInput{UserID: 42, OrganizationID: &orgID})
	if err != nil {
		t.Fatalf("get org memories: %v", err)
	}
	if len(records) != 1 || records[0].OrganizationID == nil || *records[0].OrganizationID != orgID {
		t.Fatalf("unexpected org memory records: %#v", records)
	}

	mock.ExpectExec("DeleteMemory").WithArgs(int32(1), int32(42)).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := store.DeleteMemory(ctx, memories.DeleteMemoryInput{ID: 1, UserID: 42}); err != nil {
		t.Fatalf("delete memory: %v", err)
	}

	mock.ExpectExec("DeleteMemoryWithOrg").WithArgs(int32(1), int32(42), &orgID).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := store.DeleteMemoryWithOrg(ctx, memories.DeleteMemoryWithOrgInput{ID: 1, UserID: 42, OrganizationID: &orgID}); err != nil {
		t.Fatalf("delete org memory: %v", err)
	}

	mock.ExpectQuery("CreateMemory").WithArgs(int32(42), pgxmock.AnyArg(), "new fact", "fact", []byte(nil)).WillReturnRows(memoryRows())
	if err := store.CreateMemory(ctx, memories.CreateMemoryInput{UserID: 42, Content: "new fact", Type: "fact"}); err != nil {
		t.Fatalf("create memory: %v", err)
	}

	mock.ExpectQuery("CreateMemory").WithArgs(int32(42), &orgID, "org fact", "fact", []byte(nil)).WillReturnRows(memoryRows())
	if err := store.CreateMemory(ctx, memories.CreateMemoryInput{UserID: 42, OrganizationID: &orgID, Content: "org fact", Type: "fact"}); err != nil {
		t.Fatalf("create org memory: %v", err)
	}

	mock.ExpectQuery("UpdateMemory").WithArgs(int32(1), "edited fact", "fact", []byte(`{"source":"user_edit"}`), int32(42)).WillReturnRows(memoryRows())
	record, err := store.UpdateMemory(ctx, memories.UpdateMemoryStoreInput{ID: 1, UserID: 42, Content: "edited fact", Type: "fact", Metadata: []byte(`{"source":"user_edit"}`)})
	if err != nil {
		t.Fatalf("update memory: %v", err)
	}
	if record.ID != 1 || record.UserID != 42 {
		t.Fatalf("unexpected updated memory record: %#v", record)
	}

	mock.ExpectQuery("UpdateMemoryWithOrg").WithArgs(int32(1), "edited org fact", "fact", []byte(`{"source":"user_edit"}`), int32(42), &orgID).WillReturnRows(memoryRows())
	record, err = store.UpdateMemoryWithOrg(ctx, memories.UpdateMemoryWithOrgStoreInput{ID: 1, UserID: 42, OrganizationID: &orgID, Content: "edited org fact", Type: "fact", Metadata: []byte(`{"source":"user_edit"}`)})
	if err != nil {
		t.Fatalf("update org memory: %v", err)
	}
	if record.OrganizationID == nil || *record.OrganizationID != orgID {
		t.Fatalf("unexpected updated org memory record: %#v", record)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMemoryStoreAdapterQueryErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	adapter := memoryStoreAdapter{q: db.New(mock)}
	mock.ExpectQuery(`SELECT .* FROM memories`).WithArgs(int32(9)).WillReturnError(errors.New("memories failed"))

	_, err := adapter.GetUserMemories(context.Background(), 9)
	require.Error(t, err)

	mock.ExpectQuery(`SELECT .* FROM memories`).WithArgs(int32(9), (*int32)(nil)).WillReturnError(errors.New("memories failed"))
	_, err = adapter.GetUserMemoriesWithOrg(context.Background(), memories.GetUserMemoriesWithOrgInput{
		UserID: 9,
	})
	require.Error(t, err)

	mock.ExpectQuery("UpdateMemory").
		WithArgs(int32(1), "content", "fact", []byte(nil), int32(9)).
		WillReturnError(errors.New("update failed"))
	_, err = adapter.UpdateMemory(context.Background(), memories.UpdateMemoryStoreInput{
		ID:      1,
		UserID:  9,
		Content: "content",
		Type:    "fact",
	})
	require.Error(t, err)

	orgID := int32(3)
	mock.ExpectQuery("UpdateMemoryWithOrg").
		WithArgs(int32(1), "content", "fact", []byte(nil), int32(9), &orgID).
		WillReturnError(errors.New("update org failed"))
	_, err = adapter.UpdateMemoryWithOrg(context.Background(), memories.UpdateMemoryWithOrgStoreInput{
		ID:             1,
		UserID:         9,
		OrganizationID: &orgID,
		Content:        "content",
		Type:           "fact",
	})
	require.Error(t, err)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestMemoryTimestampStringInvalid(t *testing.T) {
	assert.Empty(t, memoryTimestampString(pgtype.Timestamp{}))
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
