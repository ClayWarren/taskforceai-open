package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	enginehandler "github.com/TaskForceAI/go-engine/pkg/handler"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withEngineQueryLoaderError(t *testing.T) {
	t.Helper()
	swap(t, &enginehandler.GetQueries, func(context.Context) (*db.Queries, error) {
		return nil, errors.New("loader failed")
	})
}

func withLoaderQueries(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	swap(t, &enginehandler.GetQueries, func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
}

func conversationListRows() *pgxmock.Rows {
	columns := []string{
		"id", "timestamp", "user_id", "organization_id", "user_input", "result", "execution_time", "model", "agent_count",
		"project_id", "is_public", "share_id", "public_shared_at", "vector_clock", "sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at",
	}
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	userID := "user-1"
	result := "done"
	executionTime := 1.5
	model := "gpt-5.6-sol"
	return pgxmock.NewRows(columns).AddRow(
		int32(1), now, &userID, (*int32)(nil), "prompt", &result, &executionTime, &model, int32(3),
		nil, false, nil, pgtype.Timestamp{}, []byte("{}"), int32(1), now, nil, false, now,
	)
}

func TestConversationServiceLoaderDelegatesErrors(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}

	loader := conversationServiceLoader{}
	ctx := context.Background()

	_, err := loader.ListConversations(ctx, "1", nil, 10, 0)
	require.Error(t, err)

	_, err = loader.GetConversation(ctx, "1", nil, 1)
	require.Error(t, err)

	_, err = loader.CreateConversation(ctx, conversationspkg.ConversationCreateInput{UserID: "1"})
	require.Error(t, err)

	_, err = loader.UpdateConversation(ctx, "1", nil, 1, conversationspkg.ConversationUpdateInput{})
	require.Error(t, err)

	_, err = loader.DeleteConversation(ctx, "1", nil, 1)
	assert.Error(t, err)
}

func TestConversationServiceLoaderOrgScopedSuccess(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withLoaderQueries(t, mock)

	ctx := context.Background()
	loader := conversationServiceLoader{}
	userID := "user-1"
	orgID := 7
	orgID32 := int32(orgID)

	mock.ExpectQuery("CountConversationsByUserAndOrg").
		WithArgs(&userID, &orgID32).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("GetConversationsByUserAndOrg").
		WithArgs(&userID, &orgID32, int32(10), int32(0)).
		WillReturnRows(conversationListRows())

	page, err := loader.ListConversations(ctx, userID, &orgID, 10, 0)
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Equal(t, 1, page.Total)

	mock.ExpectQuery("GetConversationByUserOrgAndID").
		WithArgs(int32(1), &userID, &orgID32).
		WillReturnRows(conversationListRows())
	view, err := loader.GetConversation(ctx, userID, &orgID, 1)
	require.NoError(t, err)
	assert.Equal(t, 1, view.ID)

	model := "gpt-5.6-sol"
	mock.ExpectQuery("CreateConversation").
		WithArgs(&userID, &orgID32, "org prompt", &model, int32(2), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(conversationListRows())
	created, err := loader.CreateConversation(ctx, conversationspkg.ConversationCreateInput{
		UserID: userID, OrganizationID: &orgID, UserInput: "org prompt", Model: &model, AgentCount: 2,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, created.ID)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestConversationServiceLoaderReturnsQueryLoaderErrors(t *testing.T) {
	withEngineQueryLoaderError(t)
	loader := conversationServiceLoader{}
	ctx := context.Background()

	_, err := loader.ListConversations(ctx, "user-1", nil, 10, 0)
	require.EqualError(t, err, "loader failed")

	_, err = loader.GetConversation(ctx, "user-1", nil, 1)
	require.EqualError(t, err, "loader failed")

	_, err = loader.CreateConversation(ctx, conversationspkg.ConversationCreateInput{})
	require.EqualError(t, err, "loader failed")

	updated, err := loader.UpdateConversation(ctx, "user-1", nil, 1, conversationspkg.ConversationUpdateInput{})
	assert.False(t, updated)
	require.EqualError(t, err, "loader failed")

	deleted, err := loader.DeleteConversation(ctx, "user-1", nil, 1)
	assert.False(t, deleted)
	assert.EqualError(t, err, "loader failed")
}

func TestConversationServiceLoaderSuccessPaths(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withLoaderQueries(t, mock)

	ctx := context.Background()
	loader := conversationServiceLoader{}
	userID := "user-1"

	mock.ExpectQuery("CountConversationsByUser").WithArgs(&userID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("GetConversationsByUser").WithArgs(&userID, int32(10), int32(0)).WillReturnRows(conversationListRows())
	page, err := loader.ListConversations(ctx, userID, nil, 10, 0)
	require.NoError(t, err)
	require.NotNil(t, page)
	assert.Equal(t, 1, page.Total)

	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnRows(conversationListRows())
	view, err := loader.GetConversation(ctx, userID, nil, 1)
	require.NoError(t, err)
	assert.Equal(t, 1, view.ID)

	model := "gpt-5.6-sol"
	mock.ExpectQuery("CreateConversation").WithArgs(
		&userID, pgxmock.AnyArg(), "new prompt", &model, int32(2), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnRows(conversationListRows())
	created, err := loader.CreateConversation(ctx, conversationspkg.ConversationCreateInput{
		UserID: userID, UserInput: "new prompt", Model: &model, AgentCount: 2,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, created.ID)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestConversationServiceLoaderUpdateAndDeleteSuccess(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withLoaderQueries(t, mock)

	ctx := context.Background()
	loader := conversationServiceLoader{}
	userID := "user-1"

	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnRows(conversationListRows())
	mock.ExpectExec("UpdateConversation").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	result := "done"
	updated, err := loader.UpdateConversation(ctx, userID, nil, 1, conversationspkg.ConversationUpdateInput{Result: &result})
	require.NoError(t, err)
	assert.True(t, updated)

	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnRows(conversationListRows())
	mock.ExpectExec("SoftDeleteConversation").WithArgs(int32(1), &userID).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	deleted, err := loader.DeleteConversation(ctx, userID, nil, 1)
	require.NoError(t, err)
	assert.True(t, deleted)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestConversationStoreAdapterDatabaseErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	svc := enginehandler.NewConversationServiceFromQueries(db.New(mock))
	ctx := context.Background()
	userID := "user-9"
	orgID := 3
	orgID32 := int32(orgID)
	dbErr := errors.New("conversation query failed")

	mock.ExpectQuery("CountConversationsByUser").WithArgs(&userID).WillReturnError(dbErr)
	_, err := svc.ListConversations(ctx, userID, nil, 10, 0)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("CountConversationsByUserAndOrg").WithArgs(&userID, &orgID32).WillReturnError(dbErr)
	_, err = svc.ListConversations(ctx, userID, &orgID, 10, 0)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnError(dbErr)
	_, err = svc.GetConversation(ctx, userID, nil, 1)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("GetConversationByUserOrgAndID").WithArgs(int32(1), &userID, &orgID32).WillReturnError(dbErr)
	_, err = svc.GetConversation(ctx, userID, &orgID, 1)
	require.ErrorIs(t, err, dbErr)

	model := "gpt"
	mock.ExpectQuery("CreateConversation").WithArgs(
		&userID, &orgID32, "prompt", &model, int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnError(dbErr)
	_, err = svc.CreateConversation(ctx, conversationspkg.ConversationCreateInput{
		UserID: userID, OrganizationID: &orgID, UserInput: "prompt", Model: &model, AgentCount: 1,
	})
	require.ErrorIs(t, err, dbErr)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestIntegrationsServiceLoaderDelegatesErrors(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}

	loader := integrationsServiceLoader{}
	ctx := context.Background()

	_, err := loader.ListIntegrations(ctx, 1)
	require.Error(t, err)

	err = loader.Disconnect(ctx, 1, "github")
	assert.Error(t, err)
}

func TestIntegrationsServiceLoaderReturnsQueryLoaderErrors(t *testing.T) {
	withEngineQueryLoaderError(t)
	loader := integrationsServiceLoader{}
	ctx := context.Background()

	_, err := loader.ListIntegrations(ctx, 1)
	require.EqualError(t, err, "loader failed")

	err = loader.Disconnect(ctx, 1, "google-drive")
	assert.EqualError(t, err, "loader failed")
}

func TestIntegrationsServiceLoaderSuccessPaths(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withLoaderQueries(t, mock)

	ctx := context.Background()
	loader := integrationsServiceLoader{}
	now := pgtype.Timestamp{Time: time.Unix(50, 0), Valid: true}

	mock.ExpectQuery("GetAccountsByUserID").WithArgs(int32(9)).WillReturnRows(
		pgxmock.NewRows([]string{
			"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state",
		}).AddRow("acc-1", int32(9), "oauth", "github", "provider-id", nil, nil, nil, nil, nil, nil, nil),
	)
	userID := int32(9)
	mock.ExpectQuery("GetActiveDeviceLoginsByUserID").WithArgs(pgxmock.AnyArg()).WillReturnRows(
		pgxmock.NewRows([]string{
			"id", "device_code", "user_code", "status", "user_id", "poll_interval", "created_at", "expires_at", "authorized_at", "completed_at", "last_polled_at",
		}).AddRow(int32(9), "device", "user", "COMPLETED", &userID, int32(5), now, now, now, now, now),
	)
	statuses, err := loader.ListIntegrations(ctx, 9)
	require.NoError(t, err)
	assert.NotEmpty(t, statuses)

	mock.ExpectExec("DeleteAccount").WithArgs(int32(9), "github").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, loader.Disconnect(ctx, 9, "github"))

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadConversationAndIntegrationsServiceErrors(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}

	_, err := loadConversationService(context.Background())
	require.Error(t, err)

	_, err = loadIntegrationsService(context.Background())
	require.Error(t, err)
}
