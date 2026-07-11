package notifications

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	corenotifications "github.com/TaskForceAI/core/pkg/notifications"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

type fakePushTokenDB struct {
	t        *testing.T
	wantArgs []any
	tag      pgconn.CommandTag
	err      error
}

func (f fakePushTokenDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	require.Equal(f.t, f.wantArgs, args)
	return f.tag, f.err
}

func (f fakePushTokenDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	f.t.Fatal("Query should not be called")
	return nil, nil
}

func (f fakePushTokenDB) QueryRow(context.Context, string, ...any) pgx.Row {
	f.t.Fatal("QueryRow should not be called")
	return nil
}

func TestPushTokenStoreUpsertMapsCoreInput(t *testing.T) {
	deviceID := "device-1"
	appVersion := "1.2.3"
	userID := int32(42)
	registeredAt := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)

	store := NewPushTokenStore(db.New(fakePushTokenDB{
		t: t,
		wantArgs: []any{
			"token-1",
			"ios",
			&deviceID,
			&appVersion,
			&userID,
			pgtype.Timestamp{Time: registeredAt, Valid: true},
		},
		tag: pgconn.NewCommandTag("INSERT 0 1"),
	}))

	err := store.UpsertPushToken(context.Background(), corenotifications.UpsertPushTokenInput{
		Token:            "token-1",
		Platform:         "ios",
		DeviceID:         &deviceID,
		AppVersion:       &appVersion,
		UserID:           userID,
		LastRegisteredAt: registeredAt,
	})
	require.NoError(t, err)
}

func TestPushTokenStoreDeleteMapsCoreInputAndRows(t *testing.T) {
	userID := int32(42)
	store := NewPushTokenStore(db.New(fakePushTokenDB{
		t:        t,
		wantArgs: []any{&userID, "token-1"},
		tag:      pgconn.NewCommandTag("DELETE 3"),
	}))

	rows, err := store.DeletePushToken(context.Background(), corenotifications.DeletePushTokenInput{
		UserID: userID,
		Token:  "token-1",
	})
	require.NoError(t, err)
	require.Equal(t, int64(3), rows)
}
