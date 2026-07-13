package notifications

import (
	"context"
	"fmt"
	"math"
	"time"
)

type PushTokenStore interface {
	UpsertPushToken(ctx context.Context, input UpsertPushTokenInput) error
	DeletePushToken(ctx context.Context, input DeletePushTokenInput) (int64, error)
}

type UpsertPushTokenInput struct {
	Token            string
	Platform         string
	DeviceID         *string
	AppVersion       *string
	UserID           int32
	LastRegisteredAt time.Time
}

type DeletePushTokenInput struct {
	UserID int32
	Token  string
}

// PushTokenService handles push token operations directly.
type PushTokenService struct {
	store PushTokenStore
}

// NewPushTokenService creates a new push token service.
func NewPushTokenService(store PushTokenStore) *PushTokenService {
	return &PushTokenService{store: store}
}

// RegisterPushTokenInput is the input for registering a push token
type RegisterPushTokenInput struct {
	Token      string
	Platform   string
	DeviceID   *string
	AppVersion *string
	UserID     int
}

// RegisterToken registers or updates a push token.
func (s *PushTokenService) RegisterToken(ctx context.Context, input RegisterPushTokenInput) error {
	uid, err := int32UserID(input.UserID)
	if err != nil {
		return err
	}

	return s.store.UpsertPushToken(ctx, UpsertPushTokenInput{
		Token:            input.Token,
		Platform:         input.Platform,
		DeviceID:         input.DeviceID,
		AppVersion:       input.AppVersion,
		UserID:           uid,
		LastRegisteredAt: time.Now(),
	})
}

// UnregisterToken removes a push token.
func (s *PushTokenService) UnregisterToken(ctx context.Context, userID int, token string) (int, error) {
	uid, err := int32UserID(userID)
	if err != nil {
		return 0, err
	}
	rows, err := s.store.DeletePushToken(ctx, DeletePushTokenInput{
		UserID: uid,
		Token:  token,
	})
	return int(rows), err
}

func int32UserID(userID int) (int32, error) {
	if userID < math.MinInt32 || userID > math.MaxInt32 {
		return 0, fmt.Errorf("user_id exceeds int32 range")
	}
	return int32(userID), nil
}
