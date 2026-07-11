package auth_test

import (
	"context"
	"errors"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

type authorizeRepoStub struct {
	record    *auth.DeviceLoginRecord
	updateErr error
}

func (r *authorizeRepoStub) FindActiveLoginByCodes(context.Context, string, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (r *authorizeRepoStub) CreateLogin(context.Context, auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (r *authorizeRepoStub) FindByUserCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return r.record, nil
}

func (r *authorizeRepoStub) FindByDeviceCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (r *authorizeRepoStub) UpdateLogin(context.Context, int, auth.DeviceLoginUpdate) error {
	return r.updateErr
}

func (r *authorizeRepoStub) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return true, nil
}

func (r *authorizeRepoStub) MarkDeviceLoginAsCompleted(context.Context, int) (bool, error) {
	return false, nil
}

func (r *authorizeRepoStub) FindUserByID(context.Context, int) (*auth.DeviceLoginUser, error) {
	return nil, nil
}

type collisionRepo struct {
	attempts *int
}

func (r *collisionRepo) FindActiveLoginByCodes(context.Context, string, string) (*auth.DeviceLoginRecord, error) {
	*r.attempts++
	if *r.attempts == 1 {
		return &auth.DeviceLoginRecord{ID: 1}, nil
	}
	return nil, nil
}

func (r *collisionRepo) CreateLogin(context.Context, auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	return &auth.DeviceLoginRecord{
		DeviceCode: "device",
		UserCode:   "ABCD-1234",
	}, nil
}

func (r *collisionRepo) FindByUserCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (r *collisionRepo) FindByDeviceCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (r *collisionRepo) UpdateLogin(context.Context, int, auth.DeviceLoginUpdate) error {
	return nil
}

func (r *collisionRepo) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return true, nil
}

func (r *collisionRepo) MarkDeviceLoginAsCompleted(context.Context, int) (bool, error) {
	return false, nil
}

func (r *collisionRepo) FindUserByID(context.Context, int) (*auth.DeviceLoginUser, error) {
	return nil, nil
}

func requirePayload(t *testing.T, payload *auth.DeviceLoginStartPayload) {
	t.Helper()
	if payload == nil || payload.DeviceCode == "" || payload.UserCode == "" {
		t.Fatal("expected device login payload")
	}
}

func TestDeviceLoginService_AuthorizeDeviceLogin(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		DeviceLoginRecord: &auth.DeviceLoginRecord{
			ID:        1,
			UserCode:  "ABCD-1234",
			Status:    auth.DeviceStatusPending,
			ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	service := auth.NewDeviceLoginService(mockRepo)

	err := service.AuthorizeDeviceLogin(context.Background(), 123, "abcd1234")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
}

func TestDeviceLoginService_AuthorizeDeviceLogin_UpdateErrors(t *testing.T) {
	service := auth.NewDeviceLoginService(&deviceRepoStub{
		record: &auth.DeviceLoginRecord{
			ID:        1,
			Status:    auth.DeviceStatusPending,
			ExpiresAt: time.Now().Add(-time.Hour),
		},
		updateErr: errors.New("update failed"),
	})

	err := service.AuthorizeDeviceLogin(context.Background(), 123, "abcd1234")

	assert.ErrorContains(t, err, "failed to mark login expired")
}

func TestDeviceLoginService_Authorize_AlreadyAuthorized(t *testing.T) {
	repo := &authorizeRepoStub{
		record: &auth.DeviceLoginRecord{
			ID:        4,
			UserCode:  "WXYZ-9876",
			Status:    auth.DeviceStatusAuthorized,
			ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	service := auth.NewDeviceLoginService(repo)

	err := service.AuthorizeDeviceLogin(context.Background(), 1, "WXYZ9876")
	assert.ErrorIs(t, err, auth.ErrAlreadyUsed)
}

func TestDeviceLoginService_Authorize_Errors(t *testing.T) {
	// 1. Not Found
	mockRepo := &testutils.MockRepository{DeviceLoginRecord: nil}
	service := auth.NewDeviceLoginService(mockRepo)
	err := service.AuthorizeDeviceLogin(context.Background(), 1, "MISSING")
	assert.Equal(t, auth.ErrInvalidCode, err)

	// 2. Expired
	mockRepo.DeviceLoginRecord = &auth.DeviceLoginRecord{
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	err = service.AuthorizeDeviceLogin(context.Background(), 1, "EXPIRED")
	assert.Equal(t, auth.ErrExpired, err)

	// 3. Already Claimed
	mockRepo.DeviceLoginRecord = &auth.DeviceLoginRecord{
		ExpiresAt: time.Now().Add(time.Hour),
		Status:    auth.DeviceStatusCompleted,
	}
	err = service.AuthorizeDeviceLogin(context.Background(), 1, "USED")
	assert.Equal(t, auth.ErrAlreadyUsed, err)

	// 4. Already Authorized (must not be overwritten by another user)
	mockRepo.DeviceLoginRecord = &auth.DeviceLoginRecord{
		ExpiresAt: time.Now().Add(time.Hour),
		Status:    auth.DeviceStatusAuthorized,
	}
	err = service.AuthorizeDeviceLogin(context.Background(), 2, "AUTHORIZED")
	assert.Equal(t, auth.ErrAlreadyUsed, err)
}

func TestDeviceLoginService_Authorize_ExpireUpdateError(t *testing.T) {
	repo := &authorizeRepoStub{
		record: &auth.DeviceLoginRecord{
			ID:        9,
			Status:    auth.DeviceStatusPending,
			ExpiresAt: time.Now().Add(-time.Minute),
		},
		updateErr: errors.New("update failed"),
	}
	service := auth.NewDeviceLoginService(repo)

	err := service.AuthorizeDeviceLogin(context.Background(), 1, "ABCD-1234")
	assert.ErrorContains(t, err, "failed to mark login expired")
}

func TestDeviceLoginService_Authorize_MarksExpiredOnLatePoll(t *testing.T) {
	repo := &authorizeRepoStub{
		record: &auth.DeviceLoginRecord{
			ID:        9,
			Status:    auth.DeviceStatusPending,
			ExpiresAt: time.Now().Add(-time.Minute),
		},
	}
	service := auth.NewDeviceLoginService(repo)

	err := service.AuthorizeDeviceLogin(context.Background(), 1, "ABCD-1234")
	assert.Equal(t, auth.ErrExpired, err)
}

func TestDeviceLoginService_Authorize_ShortUserCodeFallback(t *testing.T) {
	repo := &authorizeRepoStub{record: nil}
	service := auth.NewDeviceLoginService(repo)

	err := service.AuthorizeDeviceLogin(context.Background(), 1, "ABC")
	assert.Equal(t, auth.ErrInvalidCode, err)
}

func TestDeviceLoginService_ExchangeDeviceToken_Approved(t *testing.T) {
	uid := 123
	mockRepo := &testutils.MockRepository{
		DeviceLoginRecord: &auth.DeviceLoginRecord{
			ID:        1,
			Status:    auth.DeviceStatusAuthorized,
			UserID:    &uid,
			ExpiresAt: time.Now().Add(time.Hour),
		},
		DeviceUser: &auth.DeviceLoginUser{
			ID:    123,
			Email: "test@example.com",
		},
		MarkCompletedResult: true,
	}
	service := auth.NewDeviceLoginService(mockRepo)

	outcome, err := service.ExchangeDeviceToken(context.Background(), "dev", "secret_must_be_32_chars_long_exactly!!")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if outcome.Kind != "APPROVED" {
		t.Errorf("Expected APPROVED, got %s", outcome.Kind)
	}
	if outcome.AccessToken == "" {
		t.Error("Expected access token")
	}
	assert.Equal(t, auth.DefaultSessionMaxAge, outcome.ExpiresIn)
}

func TestDeviceLoginService_ExchangeDeviceToken_EnterpriseUserUsesOrgTTL(t *testing.T) {
	secret := "secret_must_be_32_chars_long_exactly!!"
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	auth.ResetJWTKeysForTest()
	t.Cleanup(auth.ResetJWTKeysForTest)

	uid := 123
	internalOrgID := 77
	workosOrgID := "org_enterprise"
	mockRepo := &testutils.MockRepository{
		DeviceLoginRecord: &auth.DeviceLoginRecord{
			ID:        1,
			Status:    auth.DeviceStatusAuthorized,
			UserID:    &uid,
			ExpiresAt: time.Now().Add(time.Hour),
		},
		DeviceUser: &auth.DeviceLoginUser{
			ID:            123,
			Email:         "enterprise@example.com",
			InternalOrgID: &internalOrgID,
			OrgID:         &workosOrgID,
		},
		MarkCompletedResult: true,
	}
	service := auth.NewDeviceLoginService(mockRepo)

	outcome, err := service.ExchangeDeviceToken(context.Background(), "dev", secret)

	require.NoError(t, err)
	require.NotNil(t, outcome)
	assert.Equal(t, "APPROVED", outcome.Kind)
	assert.Equal(t, auth.EnterpriseSessionMaxAge, outcome.ExpiresIn)

	token, err := jwt.Parse(outcome.AccessToken, func(token *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	require.NoError(t, err)
	require.True(t, token.Valid)
	claims, ok := token.Claims.(jwt.MapClaims)
	require.True(t, ok)
	assert.Equal(t, float64(internalOrgID), claims["org_id"])
	assert.Equal(t, workosOrgID, claims["workos_org_id"])
}

func TestDeviceLoginService_ExchangeDeviceToken_ErrorBranches(t *testing.T) {
	for _, tc := range []struct {
		name    string
		repo    auth.DeviceLoginRepository
		wantErr string
		want    string
	}{
		{
			name: "find device error",
			repo: &testutils.MockRepository{
				DeviceLoginErr: errors.New("lookup failed"),
			},
			wantErr: "failed to find login by device code",
		},
		{
			name: "expire update error",
			repo: &deviceRepoStub{
				record:    &auth.DeviceLoginRecord{ID: 1, ExpiresAt: time.Now().Add(-time.Hour)},
				updateErr: errors.New("update failed"),
			},
			wantErr: "failed to mark login expired",
		},
		{
			name: "pending poll update error",
			repo: &deviceRepoStub{
				record: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusPending,
					ExpiresAt: time.Now().Add(time.Hour),
				},
				pollErr: errors.New("poll failed"),
			},
			wantErr: "failed to record login poll",
		},
		{
			name: "pending poll too soon",
			repo: &deviceRepoStub{
				record: &auth.DeviceLoginRecord{
					ID:           1,
					Status:       auth.DeviceStatusPending,
					ExpiresAt:    time.Now().Add(time.Hour),
					PollInterval: 5,
				},
				pollDenied: true,
			},
			want: "SLOW_DOWN",
		},
		{
			name: "user lookup error",
			repo: &testutils.MockRepository{
				DeviceLoginRecord: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusAuthorized,
					UserID:    new(123),
					ExpiresAt: time.Now().Add(time.Hour),
				},
				DeviceUserErr: errors.New("user lookup failed"),
			},
			wantErr: "failed to resolve user",
		},
		{
			name: "missing user",
			repo: &testutils.MockRepository{
				DeviceLoginRecord: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusAuthorized,
					UserID:    new(123),
					ExpiresAt: time.Now().Add(time.Hour),
				},
			},
			want: "INVALID_USER",
		},
		{
			name: "disabled user",
			repo: &testutils.MockRepository{
				DeviceLoginRecord: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusAuthorized,
					UserID:    new(123),
					ExpiresAt: time.Now().Add(time.Hour),
				},
				DeviceUser: &auth.DeviceLoginUser{ID: 123, Email: "user@example.com", Disabled: true},
			},
			want: "INVALID_USER",
		},
		{
			name: "complete error",
			repo: &testutils.MockRepository{
				DeviceLoginRecord: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusAuthorized,
					UserID:    new(123),
					ExpiresAt: time.Now().Add(time.Hour),
				},
				DeviceUser:       &auth.DeviceLoginUser{ID: 123, Email: "user@example.com"},
				MarkCompletedErr: errors.New("complete failed"),
			},
			wantErr: "failed to complete login",
		},
		{
			name: "already claimed race",
			repo: &testutils.MockRepository{
				DeviceLoginRecord: &auth.DeviceLoginRecord{
					ID:        1,
					Status:    auth.DeviceStatusAuthorized,
					UserID:    new(123),
					ExpiresAt: time.Now().Add(time.Hour),
				},
				DeviceUser: &auth.DeviceLoginUser{ID: 123, Email: "user@example.com"},
			},
			want: "ALREADY_CLAIMED",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := auth.NewDeviceLoginService(tc.repo)

			outcome, err := service.ExchangeDeviceToken(context.Background(), "dev", "secret_must_be_32_chars_long_exactly!!")

			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				assert.Nil(t, outcome)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, outcome.Kind)
		})
	}
}

//go:fix inline

type deviceRepoStub struct {
	record            *auth.DeviceLoginRecord
	findErr           error
	updateErr         error
	pollDenied        bool
	pollErr           error
	user              *auth.DeviceLoginUser
	userErr           error
	markCompleted     bool
	markCompletedErr  error
	createErr         error
	activeLoginRecord *auth.DeviceLoginRecord
}

func (r *deviceRepoStub) FindActiveLoginByCodes(context.Context, string, string) (*auth.DeviceLoginRecord, error) {
	if r.findErr != nil {
		return nil, r.findErr
	}
	return r.activeLoginRecord, nil
}

func (r *deviceRepoStub) CreateLogin(_ context.Context, input auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	if r.createErr != nil {
		return nil, r.createErr
	}
	return &auth.DeviceLoginRecord{
		DeviceCode:   input.DeviceCode,
		UserCode:     input.UserCode,
		ExpiresAt:    input.ExpiresAt,
		PollInterval: input.PollInterval,
	}, nil
}

func (r *deviceRepoStub) FindByUserCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return r.record, r.findErr
}

func (r *deviceRepoStub) FindByDeviceCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return r.record, r.findErr
}

func (r *deviceRepoStub) UpdateLogin(context.Context, int, auth.DeviceLoginUpdate) error {
	return r.updateErr
}

func (r *deviceRepoStub) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return !r.pollDenied, r.pollErr
}

func (r *deviceRepoStub) MarkDeviceLoginAsCompleted(context.Context, int) (bool, error) {
	return r.markCompleted, r.markCompletedErr
}

func (r *deviceRepoStub) FindUserByID(context.Context, int) (*auth.DeviceLoginUser, error) {
	return r.user, r.userErr
}

func TestDeviceLoginService_ExchangeDeviceToken_Pending(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		DeviceLoginRecord: &auth.DeviceLoginRecord{
			ID:           1,
			Status:       auth.DeviceStatusPending,
			ExpiresAt:    time.Now().Add(time.Hour),
			PollInterval: 5,
		},
	}
	service := auth.NewDeviceLoginService(mockRepo)

	outcome, err := service.ExchangeDeviceToken(context.Background(), "dev", "secret")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if outcome.Kind != "PENDING" {
		t.Errorf("Expected PENDING, got %s", outcome.Kind)
	}
}

func TestDeviceLoginService_Exchange_Errors(t *testing.T) {
	// 1. Not Found
	mockRepo := &testutils.MockRepository{DeviceLoginRecord: nil}
	service := auth.NewDeviceLoginService(mockRepo)
	outcome, err := service.ExchangeDeviceToken(context.Background(), "MISSING", "secret")
	require.NoError(t, err)
	assert.Equal(t, "INVALID_CODE", outcome.Kind)

	// 2. Expired
	mockRepo.DeviceLoginRecord = &auth.DeviceLoginRecord{
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	outcome, err = service.ExchangeDeviceToken(context.Background(), "EXPIRED", "secret")
	require.NoError(t, err)
	assert.Equal(t, "EXPIRED", outcome.Kind)

	// 3. Already Claimed
	mockRepo.DeviceLoginRecord = &auth.DeviceLoginRecord{
		ExpiresAt: time.Now().Add(time.Hour),
		Status:    auth.DeviceStatusCompleted,
	}
	outcome, err = service.ExchangeDeviceToken(context.Background(), "USED", "secret")
	require.NoError(t, err)
	assert.Equal(t, "ALREADY_CLAIMED", outcome.Kind)
}

func TestDeviceLoginService_ExplicitNotFoundOutcomes(t *testing.T) {
	t.Run("start treats missing generated codes as available", func(t *testing.T) {
		repo := &deviceRepoStub{findErr: auth.ErrDeviceLoginNotFound}
		payload, err := auth.NewDeviceLoginService(repo).StartDeviceLogin(context.Background(), "https://example.com")
		require.NoError(t, err)
		require.NotNil(t, payload)
	})

	t.Run("authorize maps missing code to invalid code", func(t *testing.T) {
		repo := &deviceRepoStub{findErr: auth.ErrDeviceLoginNotFound}
		err := auth.NewDeviceLoginService(repo).AuthorizeDeviceLogin(context.Background(), 1, "ABCD-EFGH")
		require.ErrorIs(t, err, auth.ErrInvalidCode)
	})

	t.Run("exchange maps missing code to invalid code", func(t *testing.T) {
		repo := &deviceRepoStub{findErr: auth.ErrDeviceLoginNotFound}
		outcome, err := auth.NewDeviceLoginService(repo).ExchangeDeviceToken(context.Background(), "missing", "secret")
		require.NoError(t, err)
		assert.Equal(t, "INVALID_CODE", outcome.Kind)
	})

	t.Run("exchange maps missing authorized user to invalid user", func(t *testing.T) {
		userID := 42
		repo := &deviceRepoStub{
			record: &auth.DeviceLoginRecord{
				ID:        1,
				Status:    auth.DeviceStatusAuthorized,
				ExpiresAt: time.Now().Add(time.Hour),
				UserID:    &userID,
			},
			userErr: auth.ErrUserNotFound,
		}
		outcome, err := auth.NewDeviceLoginService(repo).ExchangeDeviceToken(context.Background(), "device", "secret")
		require.NoError(t, err)
		assert.Equal(t, "INVALID_USER", outcome.Kind)
	})
}

func TestDeviceLoginService_StartDeviceLogin(t *testing.T) {
	mockRepo := &testutils.MockRepository{}
	service := auth.NewDeviceLoginService(mockRepo)

	payload, err := service.StartDeviceLogin(context.Background(), "https://auth.com")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if payload.DeviceCode == "" {
		t.Error("Expected device code")
	}
	if len(payload.UserCode) != 9 { // XXXX-XXXX
		t.Errorf("Expected user code length 9, got %d", len(payload.UserCode))
	}
}

func TestDeviceLoginService_StartDeviceLogin_Errors(t *testing.T) {
	t.Run("uniqueness error", func(t *testing.T) {
		service := auth.NewDeviceLoginService(&testutils.MockRepository{DeviceLoginErr: errors.New("db down")})

		payload, err := service.StartDeviceLogin(context.Background(), "https://auth.com")

		assert.Nil(t, payload)
		assert.ErrorContains(t, err, "failed to check uniqueness")
	})

	t.Run("collisions", func(t *testing.T) {
		service := auth.NewDeviceLoginService(&testutils.MockRepository{
			DeviceLoginRecord: &auth.DeviceLoginRecord{ID: 1},
		})

		payload, err := service.StartDeviceLogin(context.Background(), "https://auth.com")

		assert.Nil(t, payload)
		assert.Equal(t, auth.ErrUnavailable, err)
	})
}

func TestDeviceLoginService_StartDeviceLogin_SuccessAfterCollision(t *testing.T) {
	attempts := 0
	repo := &collisionRepo{attempts: &attempts}
	service := auth.NewDeviceLoginService(repo)

	payload, err := service.StartDeviceLogin(context.Background(), "https://auth.example.com")
	require.NoError(t, err)
	requirePayload(t, payload)
	assert.Equal(t, 2, attempts)
}
