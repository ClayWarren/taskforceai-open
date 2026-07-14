package memories

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	corememories "github.com/TaskForceAI/core/pkg/memories"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func memoryRows(orgID *int32, timestamp pgtype.Timestamp) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "user_id", "organization_id", "content", "type", "metadata", "created_at", "updated_at",
	}).AddRow(int32(1), int32(42), orgID, "remember this", "fact", []byte(`{"source":"test"}`), timestamp, timestamp)
}

func TestStoreMapsAndDelegatesQueries(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	store := NewStore(db.New(mock))
	ctx := context.Background()
	orgID := int32(7)
	timestamp := pgtype.Timestamp{
		Time:  time.Date(2026, time.July, 11, 12, 30, 0, 0, time.FixedZone("UTC-5", -5*60*60)),
		Valid: true,
	}

	mock.ExpectQuery("GetUserMemories").WithArgs(int32(42)).WillReturnRows(memoryRows(nil, timestamp))
	records, err := store.GetUserMemories(ctx, 42)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, "remember this", records[0].Content)
	assert.Equal(t, "2026-07-11T17:30:00Z", records[0].CreatedAt)

	mock.ExpectQuery("GetUserMemoriesWithOrg").WithArgs(int32(42), &orgID).WillReturnRows(memoryRows(&orgID, pgtype.Timestamp{}))
	records, err = store.GetUserMemoriesWithOrg(ctx, corememories.GetUserMemoriesWithOrgInput{
		UserID:         42,
		OrganizationID: &orgID,
	})
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, &orgID, records[0].OrganizationID)
	assert.Empty(t, records[0].CreatedAt)
	assert.Empty(t, records[0].UpdatedAt)

	mock.ExpectExec("DeleteMemory").WithArgs(int32(1), int32(42)).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, store.DeleteMemory(ctx, corememories.DeleteMemoryInput{ID: 1, UserID: 42}))

	mock.ExpectExec("DeleteMemoryWithOrg").WithArgs(int32(1), int32(42), &orgID).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, store.DeleteMemoryWithOrg(ctx, corememories.DeleteMemoryWithOrgInput{
		ID: 1, UserID: 42, OrganizationID: &orgID,
	}))

	mock.ExpectQuery("CreateMemory").
		WithArgs(int32(42), (*int32)(nil), "new fact", "fact", []byte(nil)).
		WillReturnRows(memoryRows(nil, timestamp))
	require.NoError(t, store.CreateMemory(ctx, corememories.CreateMemoryInput{
		UserID: 42, Content: "new fact", Type: "fact",
	}))

	mock.ExpectQuery("CreateMemory").
		WithArgs(int32(42), &orgID, "org fact", "fact", []byte(`{"source":"user_edit"}`)).
		WillReturnRows(memoryRows(&orgID, timestamp))
	require.NoError(t, store.CreateMemory(ctx, corememories.CreateMemoryInput{
		UserID: 42, OrganizationID: &orgID, Content: "org fact", Type: "fact", Metadata: []byte(`{"source":"user_edit"}`),
	}))

	mock.ExpectQuery("UpdateMemory").
		WithArgs(int32(1), "edited fact", "fact", []byte(`{"source":"user_edit"}`), int32(42)).
		WillReturnRows(memoryRows(nil, timestamp))
	record, err := store.UpdateMemory(ctx, corememories.UpdateMemoryStoreInput{
		ID: 1, UserID: 42, Content: "edited fact", Type: "fact", Metadata: []byte(`{"source":"user_edit"}`),
	})
	require.NoError(t, err)
	assert.Equal(t, int32(1), record.ID)

	mock.ExpectQuery("UpdateMemoryWithOrg").
		WithArgs(int32(1), "edited org fact", "fact", []byte(`{"source":"user_edit"}`), int32(42), &orgID).
		WillReturnRows(memoryRows(&orgID, timestamp))
	record, err = store.UpdateMemoryWithOrg(ctx, corememories.UpdateMemoryWithOrgStoreInput{
		ID: 1, UserID: 42, OrganizationID: &orgID, Content: "edited org fact", Type: "fact", Metadata: []byte(`{"source":"user_edit"}`),
	})
	require.NoError(t, err)
	assert.Equal(t, &orgID, record.OrganizationID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStoreReturnsQueryErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	store := NewStore(db.New(mock))
	ctx := context.Background()
	orgID := int32(3)
	queryErr := errors.New("query failed")

	mock.ExpectQuery("GetUserMemories").WithArgs(int32(9)).WillReturnError(queryErr)
	_, err := store.GetUserMemories(ctx, 9)
	require.ErrorIs(t, err, queryErr)

	mock.ExpectQuery("GetUserMemoriesWithOrg").WithArgs(int32(9), &orgID).WillReturnError(queryErr)
	_, err = store.GetUserMemoriesWithOrg(ctx, corememories.GetUserMemoriesWithOrgInput{UserID: 9, OrganizationID: &orgID})
	require.ErrorIs(t, err, queryErr)

	mock.ExpectExec("DeleteMemory").WithArgs(int32(1), int32(9)).WillReturnError(queryErr)
	require.ErrorIs(t, store.DeleteMemory(ctx, corememories.DeleteMemoryInput{ID: 1, UserID: 9}), queryErr)

	mock.ExpectExec("DeleteMemoryWithOrg").WithArgs(int32(1), int32(9), &orgID).WillReturnError(queryErr)
	require.ErrorIs(t, store.DeleteMemoryWithOrg(ctx, corememories.DeleteMemoryWithOrgInput{
		ID: 1, UserID: 9, OrganizationID: &orgID,
	}), queryErr)

	mock.ExpectQuery("CreateMemory").WithArgs(int32(9), &orgID, "content", "fact", []byte(nil)).WillReturnError(queryErr)
	require.ErrorIs(t, store.CreateMemory(ctx, corememories.CreateMemoryInput{
		UserID: 9, OrganizationID: &orgID, Content: "content", Type: "fact",
	}), queryErr)

	mock.ExpectQuery("UpdateMemory").WithArgs(int32(1), "content", "fact", []byte(nil), int32(9)).WillReturnError(queryErr)
	_, err = store.UpdateMemory(ctx, corememories.UpdateMemoryStoreInput{ID: 1, UserID: 9, Content: "content", Type: "fact"})
	require.ErrorIs(t, err, queryErr)

	mock.ExpectQuery("UpdateMemoryWithOrg").
		WithArgs(int32(1), "content", "fact", []byte(nil), int32(9), &orgID).
		WillReturnError(queryErr)
	_, err = store.UpdateMemoryWithOrg(ctx, corememories.UpdateMemoryWithOrgStoreInput{
		ID: 1, UserID: 9, OrganizationID: &orgID, Content: "content", Type: "fact",
	})
	require.ErrorIs(t, err, queryErr)
	require.NoError(t, mock.ExpectationsWereMet())
}
