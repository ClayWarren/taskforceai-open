package notifications

import (
	"context"

	"github.com/TaskForceAI/adapters/pkg/db"
	corenotifications "github.com/TaskForceAI/core/pkg/notifications"
	"github.com/jackc/pgx/v5/pgtype"
)

var _ corenotifications.PushTokenStore = (*PushTokenStore)(nil)

type PushTokenStore struct {
	q *db.Queries
}

func NewPushTokenStore(q *db.Queries) *PushTokenStore {
	return &PushTokenStore{q: q}
}

func (s *PushTokenStore) UpsertPushToken(ctx context.Context, input corenotifications.UpsertPushTokenInput) error {
	userID := input.UserID
	return s.q.UpsertPushToken(ctx, db.UpsertPushTokenParams{
		Token:            input.Token,
		Platform:         input.Platform,
		DeviceID:         input.DeviceID,
		AppVersion:       input.AppVersion,
		UserID:           &userID,
		LastRegisteredAt: pgtype.Timestamp{Time: input.LastRegisteredAt, Valid: true},
	})
}

func (s *PushTokenStore) DeletePushToken(ctx context.Context, input corenotifications.DeletePushTokenInput) (int64, error) {
	userID := input.UserID
	return s.q.DeletePushToken(ctx, db.DeletePushTokenParams{
		UserID: &userID,
		Token:  input.Token,
	})
}
