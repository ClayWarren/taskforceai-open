package run

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	memoryadapters "github.com/TaskForceAI/adapters/pkg/memories"
	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/memories"
	sharedcrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func fetchUserContextUserRow(userID int32, memoryEnabled, trustLayerEnabled bool) *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{
		ID: userID, Email: "user@example.com", Theme: "system",
		Memory: &memoryEnabled, TrustLayer: &trustLayerEnabled,
	})
}

func fetchUserContextAccountColumns() []string {
	return []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}
}

func fetchUserContextMemColumns() []string {
	return []string{"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at"}
}

func withDBQueriesMock(t *testing.T, mock pgxmock.PgxPoolIface) (*db.Queries, func()) {
	t.Helper()
	q := db.New(mock)
	originalGetter := DBQueriesGetter
	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}
	return q, func() { DBQueriesGetter = originalGetter }
}

func withTaskPersistenceMock(t *testing.T, mock pgxmock.PgxPoolIface) (*db.Queries, func()) {
	t.Helper()
	q, restoreQueries := withDBQueriesMock(t, mock)
	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return fn(sqlcTaskPersistenceStore{q: q})
	}
	return q, func() {
		RunTaskPersistenceTx = originalRunner
		restoreQueries()
	}
}

func conversationInsertColumns() []string {
	return []string{
		"id", "timestamp", "user_id", "organization_id", "user_input", "result", "execution_time",
		"model", "agent_count", "project_id", "is_public", "share_id", "public_shared_at", "vector_clock",
		"sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at",
	}
}

func messageInsertColumns() []string {
	return []string{
		"id", "message_id", "conversation_id", "role", "content", "is_streaming", "is_agent_status",
		"elapsed_seconds", "created_at", "error", "sources", "tool_events", "agent_statuses",
		"vector_clock", "sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at", "rating", "trace",
	}
}

func conversationInsertRows(id int32, ts pgtype.Timestamp) *pgxmock.Rows {
	return pgxmock.NewRows(conversationInsertColumns()).AddRow(
		id, ts, nil, nil, "prompt", nil, nil, nil, int32(4), nil, false, nil,
		pgtype.Timestamp{}, []byte("{}"), int32(0), ts, nil, false, ts,
	)
}

func messageInsertRows(id int32, messageID string, conversationID int32, ts pgtype.Timestamp) *pgxmock.Rows {
	return pgxmock.NewRows(messageInsertColumns()).AddRow(
		id, messageID, conversationID, "assistant", "result", false, false, nil, ts, nil,
		nil, nil, nil, []byte("{}"), int32(0), ts, nil, false, ts, int32(0), nil,
	)
}

func expectFinalizePersistence(mock pgxmock.PgxPoolIface, userArg any, conversationID int32, messageID string, ts pgtype.Timestamp) {
	mock.ExpectQuery(`INSERT INTO conversations`).
		WithArgs(userArg, pgxmock.AnyArg(), "prompt", pgxmock.AnyArg(), int32(4), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(conversationInsertRows(conversationID, ts))
	mock.ExpectQuery(`INSERT INTO messages`).
		WithArgs(pgxmock.AnyArg(), conversationID, "assistant", "result", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(messageInsertRows(1, messageID, conversationID, ts))
}

type captureStringArg struct {
	value *string
}

func (c captureStringArg) Match(v any) bool {
	switch typed := v.(type) {
	case string:
		*c.value = typed
		return true
	case *string:
		if typed == nil {
			*c.value = ""
			return true
		}
		*c.value = *typed
		return true
	default:
		return false
	}
}

func TestFetchUserContext_WithData(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()
	restore(t, &RedisClientGetter)
	RedisClientGetter = func() (redis.Cmdable, error) { return nil, nil }

	userID := int32(7)
	projectID := int32(55)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, false))

	memColumns := fetchUserContextMemColumns()
	mock.ExpectQuery(`SELECT .* FROM memories`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(memColumns).
			AddRow(int32(1), userID, nil, "memory one", "fact", []byte("{}"), ts, ts).
			AddRow(int32(2), userID, nil, "memory two", "preference", []byte("{}"), ts, ts))

	accessToken := (*string)(nil)
	refreshToken := (*string)(nil)
	tokenType := (*string)(nil)
	accountsColumns := []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}
	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(accountsColumns).AddRow(
			"acc-1",
			userID,
			"oauth",
			"google-drive",
			"acct-1",
			refreshToken,
			accessToken,
			nil,
			tokenType,
			nil,
			nil,
			nil,
		))

	projectColumns := []string{"id", "user_id", "organization_id", "name", "description", "custom_instructions", "created_at", "updated_at"}
	instructions := ""
	mock.ExpectQuery(`SELECT .* FROM projects`).
		WithArgs(projectID, userID).
		WillReturnRows(pgxmock.NewRows(projectColumns).AddRow(
			projectID,
			userID,
			nil,
			"Project",
			nil,
			nil,
			ts,
			ts,
		))

	memories, driveClient, projectInstructions, memoryEnabled, trustLayerEnabled, _ := fetchUserContext(int(userID), &projectID)
	assert.True(t, memoryEnabled)
	assert.False(t, trustLayerEnabled)
	assert.Equal(t, []string{"memory one", "memory two"}, memories)
	assert.Nil(t, driveClient)
	assert.Equal(t, instructions, projectInstructions)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_WithOrgUsesOrgMemories(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()
	restore(t, &RedisClientGetter)
	RedisClientGetter = func() (redis.Cmdable, error) { return nil, nil }

	userID := int32(7)
	orgID := int32(22)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, false))

	mock.ExpectQuery(`SELECT .* FROM memories`).
		WithArgs(userID, &orgID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextMemColumns()).
			AddRow(int32(1), userID, &orgID, "org memory", "preference", []byte("{}"), ts, ts))

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()))

	userContext, err := loadRunUserContext(context.Background(), UserContextLoadInput{
		UserID: userID,
		OrgID:  &orgID,
	})

	require.NoError(t, err)
	assert.Equal(t, []string{"org memory"}, userContext.Memories)
	assert.True(t, userContext.MemoryEnabled)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_UserLookupErrorFailsClosed(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(17)
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnError(errors.New("user fetch failed"))

	_, err := loadRunUserContext(context.Background(), UserContextLoadInput{UserID: userID})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "user fetch failed")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_AccountsAndProjectLookupErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withUnavailableRedis(t, errors.New("redis unavailable"))

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(18)
	projectID := int32(200)

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, true, true))

	mock.ExpectQuery(`SELECT .* FROM memories`).
		WithArgs(userID).
		WillReturnError(errors.New("memory query failed"))

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnError(errors.New("accounts query failed"))

	mock.ExpectQuery(`SELECT .* FROM projects`).
		WithArgs(projectID, userID).
		WillReturnError(errors.New("project query failed"))

	_, err := loadRunUserContext(context.Background(), UserContextLoadInput{
		UserID:    userID,
		ProjectID: &projectID,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "project 200 is not accessible")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_SkipsInvalidAccessTokens(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(19)

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, false, false))

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(
			pgxmock.NewRows(fetchUserContextAccountColumns()).
				AddRow("acc-gdrive", userID, "oauth", "google-drive", "acct-gdrive", new("anything"), new("not-encrypted"), nil, nil, nil, nil, nil).
				AddRow("acc-gh", userID, "oauth", "github", "acct-gh", nil, new("not-encrypted"), nil, nil, nil, nil, nil),
		)

	memories, driveClient, projectInstructions, memoryEnabled, trustLayerEnabled, githubToken := fetchUserContext(int(userID), nil)
	assert.False(t, memoryEnabled)
	assert.False(t, trustLayerEnabled)
	assert.Empty(t, memories)
	assert.Nil(t, driveClient)
	assert.Empty(t, projectInstructions)
	assert.Empty(t, githubToken)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_SkipsGoogleDriveOnRefreshTokenDecryptFailure(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("d", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(20)

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, false, false))

	encAccessToken, encErr := sharedcrypto.Encrypt("drive-access")
	require.NoError(t, encErr)

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(
			pgxmock.NewRows(fetchUserContextAccountColumns()).
				AddRow("acc-gdrive", userID, "oauth", "google-drive", "acct-gdrive", new("not-encrypted"), &encAccessToken, nil, nil, nil, nil, nil),
		)

	memories, driveClient, projectInstructions, memoryEnabled, trustLayerEnabled, githubToken := fetchUserContext(int(userID), nil)
	assert.False(t, memoryEnabled)
	assert.False(t, trustLayerEnabled)
	assert.Empty(t, memories)
	assert.Nil(t, driveClient)
	assert.Empty(t, projectInstructions)
	assert.Empty(t, githubToken)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFetchUserContext_CreatesDriveClientAndLoadsProjectInstructions(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("e", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "client-secret")

	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(21)
	projectID := int32(300)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, false, false))

	encAccessToken, accessErr := sharedcrypto.Encrypt("drive-access")
	require.NoError(t, accessErr)
	encRefreshToken, refreshErr := sharedcrypto.Encrypt("drive-refresh")
	require.NoError(t, refreshErr)
	encGithubToken, githubErr := sharedcrypto.Encrypt("gh-token")
	require.NoError(t, githubErr)
	customInstructions := "Always include a summary section."

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(
			pgxmock.NewRows(fetchUserContextAccountColumns()).
				AddRow("acc-gdrive", userID, "oauth", "google-drive", "acct-gdrive", &encRefreshToken, &encAccessToken, nil, nil, nil, nil, nil).
				AddRow("acc-gh", userID, "oauth", "github", "acct-gh", nil, &encGithubToken, nil, nil, nil, nil, nil),
		)

	projectColumns := []string{"id", "user_id", "organization_id", "name", "description", "custom_instructions", "created_at", "updated_at"}
	mock.ExpectQuery(`SELECT .* FROM projects`).
		WithArgs(projectID, userID).
		WillReturnRows(pgxmock.NewRows(projectColumns).AddRow(projectID, userID, nil, "Project", nil, &customInstructions, ts, ts))

	memories, driveClient, projectInstructions, memoryEnabled, trustLayerEnabled, githubToken := fetchUserContext(int(userID), &projectID)
	assert.False(t, memoryEnabled)
	assert.False(t, trustLayerEnabled)
	assert.Empty(t, memories)
	assert.NotNil(t, driveClient)
	assert.Equal(t, customInstructions, projectInstructions)
	assert.Equal(t, "gh-token", githubToken)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadRunUserContext_LoadsOrgProjectInstructions(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withUnavailableRedis(t, errors.New("redis unavailable"))

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(21)
	projectID := int32(300)
	orgID := int32(12)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	customInstructions := "Use the team's escalation policy."

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(fetchUserContextUserRow(userID, false, false))

	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(fetchUserContextAccountColumns()))

	projectColumns := []string{"id", "user_id", "organization_id", "name", "description", "custom_instructions", "created_at", "updated_at"}
	mock.ExpectQuery(`SELECT .* FROM projects`).
		WithArgs(projectID, userID, &orgID).
		WillReturnRows(pgxmock.NewRows(projectColumns).AddRow(projectID, userID, &orgID, "Org Project", nil, &customInstructions, ts, ts))

	userContext, err := loadRunUserContext(context.Background(), UserContextLoadInput{
		UserID:    userID,
		ProjectID: &projectID,
		OrgID:     &orgID,
	})
	require.NoError(t, err)
	assert.Equal(t, customInstructions, userContext.ProjectInstructions)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_ConversationPersistFailure(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()

	mock.ExpectQuery(`INSERT INTO conversations`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "prompt", pgxmock.AnyArg(), int32(4), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("insert conversation failed"))

	taskID := "finalize-conversation-error"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, StatusCompleted, state.Status)
		assert.Contains(t, state.Error, "create conversation")
		assert.Equal(t, int32(0), state.ConversationID)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_UsageFailureDoesNotRollbackConversation(t *testing.T) {
	restore(t, &RunTaskPersistenceTx)

	transactionCalls := 0
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		transactionCalls++
		if transactionCalls == 2 {
			return errors.New("usage_events unavailable")
		}
		return fn(&stubTaskPersistenceStore{
			createConversationFunc: func(context.Context, taskConversationCreateInput) (taskConversationRecord, error) {
				return taskConversationRecord{ID: 224}, nil
			},
		})
	}

	taskID := "finalize-usage-error"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
	assert.Equal(t, int32(224), state.ConversationID)
	assert.Empty(t, state.Error)
	assert.Equal(t, 2, transactionCalls)
}

func TestFinalizeTask_MemoryExtractionFailureAppendsError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()
	restore(t, &LoadMemoryStore)
	restore(t, &ExtractAndSaveMemories)
	LoadMemoryStore = func(ctx context.Context) (memories.MemoryStore, error) {
		return memoryadapters.NewStore(q), nil
	}
	ExtractAndSaveMemories = func(ctx context.Context, store memories.MemoryStore, cfg coreconfig.Config, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
		return errors.New("memory save failed")
	}

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectFinalizePersistence(mock, pgxmock.AnyArg(), 200, "msg_200", ts)

	taskID := "finalize-memory-error"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		true,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, StatusCompleted, state.Status)
		assert.Equal(t, int32(200), state.ConversationID)
		assert.Contains(t, state.Error, "memory extraction failed")
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_PassesOrgIDToMemoryExtraction(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()
	restore(t, &LoadMemoryStore)
	restore(t, &ExtractAndSaveMemories)
	LoadMemoryStore = func(ctx context.Context) (memories.MemoryStore, error) {
		return memoryadapters.NewStore(q), nil
	}

	orgID := int32(77)
	var capturedOrgID *int32
	var capturedSourceConversationID *int32
	ExtractAndSaveMemories = func(ctx context.Context, store memories.MemoryStore, cfg coreconfig.Config, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
		capturedOrgID = orgID
		capturedSourceConversationID = sourceConversationID
		return nil
	}

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectFinalizePersistence(mock, pgxmock.AnyArg(), 207, "msg_207", ts)

	taskID := "finalize-memory-org"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{OrgID: &orgID})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		true,
		OrchestrateTaskOptions{OrgID: &orgID},
		"",
	)

	if assert.NotNil(t, capturedOrgID) {
		assert.Equal(t, orgID, *capturedOrgID)
	}
	if assert.NotNil(t, capturedSourceConversationID) {
		assert.Equal(t, int32(207), *capturedSourceConversationID)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_StoresNumericConversationUserID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()

	capturedUserID := ""
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectFinalizePersistence(mock, captureStringArg{value: &capturedUserID}, 2001, "msg_2001", ts)

	taskID := "finalize-numeric-user-id"
	_ = GetRegistry().Register(taskID, 42, "prompt", "gpt-4", OrchestrateTaskOptions{})

	finalizeTask(
		context.Background(),
		taskID,
		42,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	assert.Equal(t, "42", capturedUserID)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, StatusCompleted, state.Status)
		assert.Equal(t, int32(2001), state.ConversationID)
	}

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_PersistsConfiguredAgentCount(t *testing.T) {
	restore(t, &RunTaskPersistenceTx)

	var capturedAgentCount int32
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return fn(&stubTaskPersistenceStore{
			createConversationFunc: func(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
				capturedAgentCount = input.AgentCount
				return taskConversationRecord{ID: 333}, nil
			},
		})
	}

	taskID := "finalize-agent-count"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AgentCount: 8})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		false,
		OrchestrateTaskOptions{AgentCount: 8},
		"",
	)

	assert.Equal(t, int32(8), capturedAgentCount)
}

func TestFinalizeTask_MemoryExtractionSkippedForEval(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()
	restore(t, &ExtractAndSaveMemories)

	memoryCalled := false
	ExtractAndSaveMemories = func(ctx context.Context, store memories.MemoryStore, cfg coreconfig.Config, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
		memoryCalled = true
		return nil
	}

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectFinalizePersistence(mock, pgxmock.AnyArg(), 201, "msg_201", ts)

	taskID := "finalize-memory-skip-eval"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		true,
		OrchestrateTaskOptions{IsEval: true},
		"",
	)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, StatusCompleted, state.Status)
		assert.Equal(t, int32(201), state.ConversationID)
		assert.Empty(t, state.Error)
	}
	assert.False(t, memoryCalled, "memory extraction should be skipped for eval runs")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_NoTrainingSkipsRetention(t *testing.T) {
	restore(t, &RunTaskPersistenceTx)
	restore(t, &ExtractAndSaveMemories)

	txCalled := false
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		txCalled = true
		return nil
	}

	memoryCalled := false
	ExtractAndSaveMemories = func(ctx context.Context, store memories.MemoryStore, cfg coreconfig.Config, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
		memoryCalled = true
		return nil
	}

	mockCache := new(cacheMock)

	taskID := "finalize-no-training"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{NoTraining: true})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		mockCache,
		false,
		true,
		OrchestrateTaskOptions{NoTraining: true},
		"",
	)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, StatusCompleted, state.Status)
		assert.Equal(t, int32(0), state.ConversationID)
		assert.Empty(t, state.Error)
	}

	mockCache.AssertNotCalled(t, "Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	assert.True(t, txCalled, "billing usage should be persisted when no-training is enabled")
	assert.False(t, memoryCalled, "memory extraction should be skipped when no-training is enabled")
}

func TestFetchUserContext_DecryptsEncryptedGithubToken(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("c", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mock := dbtest.NewMockPool(t)

	_, restoreQueries := withDBQueriesMock(t, mock)
	defer restoreQueries()

	userID := int32(777)
	memOff, trustOff := false, false
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(userID).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: userID, Email: "user@example.com", Theme: "system",
			Memory: &memOff, TrustLayer: &trustOff,
			APITier: db.DeveloperApiTier("free"),
		}))

	rawGithubToken := "gh-secret-token"
	encGithubToken, err := sharedcrypto.Encrypt(rawGithubToken)
	require.NoError(t, err)
	accountsColumns := []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}
	mock.ExpectQuery(`SELECT .* FROM accounts`).
		WithArgs(userID).
		WillReturnRows(pgxmock.NewRows(accountsColumns).AddRow(
			"acc-gh",
			userID,
			"oauth",
			"github",
			"acct-gh",
			nil,
			&encGithubToken,
			nil,
			nil,
			nil,
			nil,
			nil,
		))

	memories, driveClient, projectInstructions, memoryEnabled, trustLayerEnabled, githubToken := fetchUserContext(int(userID), nil)
	assert.False(t, memoryEnabled)
	assert.False(t, trustLayerEnabled)
	assert.Empty(t, memories)
	assert.Nil(t, driveClient)
	assert.Empty(t, projectInstructions)
	assert.Equal(t, rawGithubToken, githubToken)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestFinalizeTask_WithDBConversation(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	_, restorePersistence := withTaskPersistenceMock(t, mock)
	defer restorePersistence()

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectFinalizePersistence(mock, pgxmock.AnyArg(), 123, "msg_1", ts)

	taskID := "finalize-db-task"
	_ = GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		true,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	if assert.NotNil(t, state) {
		assert.Equal(t, int32(123), state.ConversationID)
	}
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBuildMessageMetadata_PreservesProgressSnapshot(t *testing.T) {
	statuses := []map[string]any{{
		"agent_id": 0,
		"status":   "COMPLETED",
		"model":    "gpt-5.6-sol",
	}}
	toolEvents := []map[string]any{{
		"agentId":       0,
		"agentLabel":    "Agent 1",
		"toolName":      "search_web",
		"arguments":     map[string]any{"query": "AI news"},
		"success":       true,
		"durationMs":    120,
		"resultPreview": "Found current results",
		"sources": []map[string]string{{
			"url":   "https://example.com/ai",
			"title": "AI News",
		}},
	}}

	sourcesData, toolEventsData, statusesData, err := buildMessageMetadata(&TaskState{
		AgentStatuses: statuses,
		ToolEvents:    toolEvents,
	})

	require.NoError(t, err)
	assert.JSONEq(t, `[{"url":"https://example.com/ai","title":"AI News"}]`, string(sourcesData))
	assert.JSONEq(t, `[{"agentId":0,"agentLabel":"Agent 1","arguments":{"query":"AI news"},"durationMs":120,"resultPreview":"Found current results","sources":[{"title":"AI News","url":"https://example.com/ai"}],"success":true,"toolName":"search_web"}]`, string(toolEventsData))
	assert.JSONEq(t, `[{"agent_id":0,"model":"gpt-5.6-sol","status":"COMPLETED"}]`, string(statusesData))
}

func TestBuildMessageMetadata_ExtractsTypedToolEventSources(t *testing.T) {
	statuses := []map[string]any{{
		"agent_id": 0,
		"status":   "COMPLETED",
	}}
	toolEvents := []agent.ToolEvent{{
		ToolName: "search_web",
		Success:  true,
		Sources: []agent.SourceReference{{
			URL:     "https://example.com/typed",
			Title:   "Typed",
			Snippet: "Typed source",
		}},
	}, {
		ToolName: "search_web",
		Success:  true,
		Sources: []agent.SourceReference{{
			URL:   "https://example.com/typed",
			Title: "Duplicate",
		}},
	}}

	sourcesData, toolEventsData, statusesData, err := buildMessageMetadata(&TaskState{
		AgentStatuses: statuses,
		ToolEvents:    toolEvents,
	})

	require.NoError(t, err)
	assert.JSONEq(t, `[{"url":"https://example.com/typed","title":"Typed","snippet":"Typed source"}]`, string(sourcesData))
	assert.Contains(t, string(toolEventsData), `"sources":[{"url":"https://example.com/typed","title":"Typed","snippet":"Typed source"}]`)
	assert.JSONEq(t, `[{"agent_id":0,"status":"COMPLETED"}]`, string(statusesData))
}
