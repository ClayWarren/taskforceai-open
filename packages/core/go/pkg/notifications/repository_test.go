package notifications

import (
	"context"
	"errors"
	"math"
	"testing"
)

type stubPushTokenStore struct {
	upsertInput UpsertPushTokenInput
	upsertErr   error

	deleteInput DeletePushTokenInput
	deleteRows  int64
	deleteErr   error
}

func (s *stubPushTokenStore) UpsertPushToken(_ context.Context, input UpsertPushTokenInput) error {
	s.upsertInput = input
	return s.upsertErr
}

func (s *stubPushTokenStore) DeletePushToken(_ context.Context, input DeletePushTokenInput) (int64, error) {
	s.deleteInput = input
	return s.deleteRows, s.deleteErr
}

func TestRegisterToken_UsesProvidedUserID(t *testing.T) {
	store := &stubPushTokenStore{}
	svc := NewPushTokenService(store)

	deviceID := "device-1"
	appVersion := "1.0.0"
	userID := int32(123)

	err := svc.RegisterToken(context.Background(), RegisterPushTokenInput{
		Token:      "token-123",
		Platform:   "ios",
		DeviceID:   &deviceID,
		AppVersion: &appVersion,
		UserID:     int(userID),
	})
	if err != nil {
		t.Fatalf("register token failed: %v", err)
	}

	if store.upsertInput.Token != "token-123" {
		t.Fatalf("expected token to be preserved, got %q", store.upsertInput.Token)
	}
	if store.upsertInput.Platform != "ios" {
		t.Fatalf("expected platform to be preserved, got %q", store.upsertInput.Platform)
	}
	if store.upsertInput.UserID != userID {
		t.Fatalf("expected user ID %d, got %v", userID, store.upsertInput.UserID)
	}
	if store.upsertInput.DeviceID == nil || *store.upsertInput.DeviceID != deviceID {
		t.Fatalf("expected device ID %q, got %v", deviceID, store.upsertInput.DeviceID)
	}
	if store.upsertInput.AppVersion == nil || *store.upsertInput.AppVersion != appVersion {
		t.Fatalf("expected app version %q, got %v", appVersion, store.upsertInput.AppVersion)
	}
	if store.upsertInput.LastRegisteredAt.IsZero() {
		t.Fatal("expected last registered timestamp to be set")
	}
}

func TestRegisterToken_PropagatesStoreError(t *testing.T) {
	expectedErr := errors.New("db unavailable")
	store := &stubPushTokenStore{upsertErr: expectedErr}
	svc := NewPushTokenService(store)

	err := svc.RegisterToken(context.Background(), RegisterPushTokenInput{
		Token:    "token-123",
		Platform: "ios",
		UserID:   123,
	})
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected %v, got %v", expectedErr, err)
	}
}

func TestRegisterToken_ReturnsErrorForOverflowingUserID(t *testing.T) {
	store := &stubPushTokenStore{}
	svc := NewPushTokenService(store)

	err := svc.RegisterToken(context.Background(), RegisterPushTokenInput{
		Token:    "token-overflow",
		Platform: "android",
		UserID:   math.MaxInt32 + 1000,
	})
	if err == nil {
		t.Fatal("expected overflow user id to return an error")
	}
	if store.upsertInput != (UpsertPushTokenInput{}) {
		t.Fatal("expected no store interaction on overflow")
	}
}

func TestUnregisterToken_ReturnsErrorForOverflowingUserID(t *testing.T) {
	store := &stubPushTokenStore{}
	svc := NewPushTokenService(store)

	rows, err := svc.UnregisterToken(context.Background(), math.MaxInt32+1, "token-1")
	if err == nil {
		t.Fatal("expected overflow user id to return an error")
	}
	if rows != 0 {
		t.Fatalf("expected 0 rows when unregister fails, got %d", rows)
	}
	if store.deleteInput != (DeletePushTokenInput{}) {
		t.Fatal("expected no store interaction on overflow")
	}
}

func TestUnregisterToken_DeletesExpectedRow(t *testing.T) {
	store := &stubPushTokenStore{deleteRows: 1}
	svc := NewPushTokenService(store)

	userID := int32(77)
	rows, err := svc.UnregisterToken(context.Background(), int(userID), "token-delete")
	if err != nil {
		t.Fatalf("unregister token failed: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected 1 row deleted, got %d", rows)
	}
	if store.deleteInput.UserID != userID {
		t.Fatalf("expected user ID %d, got %v", userID, store.deleteInput.UserID)
	}
	if store.deleteInput.Token != "token-delete" {
		t.Fatalf("expected token-delete, got %q", store.deleteInput.Token)
	}
}

func TestRegisterToken_SetsTimestamp(t *testing.T) {
	store := &stubPushTokenStore{}
	svc := NewPushTokenService(store)

	if err := svc.RegisterToken(context.Background(), RegisterPushTokenInput{
		Token:    "token-123",
		Platform: "ios",
		UserID:   123,
	}); err != nil {
		t.Fatalf("register token failed: %v", err)
	}
	if store.upsertInput.LastRegisteredAt.IsZero() {
		t.Fatal("expected valid timestamp")
	}
}
