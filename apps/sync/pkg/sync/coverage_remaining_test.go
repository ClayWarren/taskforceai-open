package sync

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRemainingConversationValidationBranches(t *testing.T) {
	blank := " "
	duplicate := "local-1"
	require.NoError(t, validateUniqueLocalConversationIDs([]ConversationSyncPayload{{LocalID: &blank}, {ID: 1, LocalID: &duplicate}}))
	require.ErrorContains(t, validateUniqueLocalConversationIDs([]ConversationSyncPayload{{LocalID: &duplicate}, {LocalID: &duplicate}}), "duplicate")

	service := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)
	_, _, _, _, err := service.syncConversations(context.Background(), new(MockSyncRepository), "user", "device", nil, 0, StrategyClientWins, []ConversationSyncPayload{{LocalID: &duplicate}, {LocalID: &duplicate}})
	require.ErrorContains(t, err, "duplicate")
}

type noTransactionRepository struct{ SyncRepository }

func (noTransactionRepository) WithTransaction(context.Context, func(SyncRepository) error) error {
	return nil
}

type transactionRepositoryWithoutProjectScope struct{ SyncRepository }

func (r transactionRepositoryWithoutProjectScope) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return fn(r)
}

type durableCoverageRepository struct {
	SyncRepository
	getErr  error
	saveErr error
}

func (r durableCoverageRepository) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return fn(r)
}
func (r durableCoverageRepository) GetSyncPushResult(context.Context, string, string) (SyncPushResponse, error) {
	return SyncPushResponse{}, r.getErr
}
func (r durableCoverageRepository) SaveSyncPushResult(context.Context, string, string, SyncPushResponse) error {
	return r.saveErr
}

func TestRemainingPushTransactionBranches(t *testing.T) {
	ctx := context.Background()
	base := new(MockSyncRepository)

	service := NewService(noTransactionRepository{SyncRepository: base}, nil, nil, nil, nil, nil)
	base.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	response, err := service.PushChanges(ctx, "user", "device", "agent", "", SyncPushRequest{})
	assert.Nil(t, response)
	require.ErrorContains(t, err, "transaction completed without a response")

	service = NewService(durableCoverageRepository{SyncRepository: base, getErr: errors.New("durable read failed")}, nil, nil, nil, nil, nil)
	_, _, err = service.applyPushTransaction(ctx, "user", "device", "key", SyncPushRequest{})
	require.ErrorContains(t, err, "load durable sync push result")

	projectID := int32(9)
	err = validateConversationProjectScopes(ctx, noTransactionRepository{SyncRepository: base}, "user", nil, []ConversationSyncPayload{{ProjectID: &projectID}})
	require.ErrorContains(t, err, "does not support project scope")
	service = NewService(transactionRepositoryWithoutProjectScope{SyncRepository: base}, nil, nil, nil, nil, nil)
	_, _, err = service.applyPushTransaction(ctx, "user", "device", "", SyncPushRequest{Conversations: []ConversationSyncPayload{{ProjectID: &projectID}}})
	require.ErrorContains(t, err, "does not support project scope")

	base.On("GetLatestSyncVersion", ctx, "user").Return(int32(0), nil).Once()
	base.On("GetSyncDevices", ctx, "user").Return([]db.SyncDevice{}, nil).Once()
	service = NewService(durableCoverageRepository{SyncRepository: base, getErr: ErrNotFound, saveErr: errors.New("durable save failed")}, nil, nil, nil, nil, nil)
	_, _, err = service.applyPushTransaction(ctx, "user", "device", "key", SyncPushRequest{})
	require.ErrorContains(t, err, "save durable sync push result")
}

func TestCachedPushRebroadcastFailure(t *testing.T) {
	ctx := context.Background()
	repo := new(MockSyncRepository)
	idem := new(MockIdempotencyStore)
	broadcaster := new(MockBroadcaster)
	service := NewService(repo, broadcaster, nil, nil, idem, nil)
	repo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	idem.On("GetResult", ctx, "user", "key").Return(IdempotencyHit{Response: SyncPushResponse{Success: true, Version: 4}}, nil).Once()
	broadcaster.On("BroadcastSyncRequired", ctx, "user", (*int32)(nil), int32(4)).Return(errors.New("broadcast failed")).Once()

	result, err := service.PushChanges(ctx, "user", "device", "agent", "key", SyncPushRequest{})
	assert.Nil(t, result)
	require.ErrorContains(t, err, "rebroadcast cached sync push")
}

func TestRepositoryDurableResultRemainingBranches(t *testing.T) {
	ctx := context.Background()
	t.Run("lock error", func(t *testing.T) {
		repo := NewRepository(db.New(repositoryErrorDB{err: assert.AnError}))
		_, err := repo.GetSyncPushResult(ctx, "user", "key")
		require.ErrorContains(t, err, "acquire durable")
	})

	t.Run("read and decode errors", func(t *testing.T) {
		mockDB := dbtest.NewMockPool(t)
		repo := NewRepository(db.New(mockDB))
		user, missing := "user", "missing"
		mockDB.ExpectExec("SELECT PG_ADVISORY_XACT_LOCK").WithArgs(&user, &missing).WillReturnResult(pgxmock.NewResult("SELECT", 1))
		mockDB.ExpectQuery("SELECT response FROM sync_push_results").WithArgs(user, missing).WillReturnError(pgx.ErrNoRows)
		_, err := repo.GetSyncPushResult(ctx, "user", "missing")
		require.ErrorIs(t, err, ErrNotFound)

		invalid := "invalid"
		mockDB.ExpectExec("SELECT PG_ADVISORY_XACT_LOCK").WithArgs(&user, &invalid).WillReturnResult(pgxmock.NewResult("SELECT", 1))
		mockDB.ExpectQuery("SELECT response FROM sync_push_results").WithArgs(user, invalid).WillReturnRows(pgxmock.NewRows([]string{"response"}).AddRow([]byte("{")))
		_, err = repo.GetSyncPushResult(ctx, "user", "invalid")
		require.ErrorContains(t, err, "decode durable")
	})

	t.Run("save", func(t *testing.T) {
		mockDB := dbtest.NewMockPool(t)
		repo := NewRepository(db.New(mockDB))
		mockDB.ExpectExec("INSERT INTO sync_push_results").WithArgs("user", "key", pgxmock.AnyArg()).WillReturnError(assert.AnError)
		require.ErrorIs(t, repo.SaveSyncPushResult(ctx, "user", "key", SyncPushResponse{}), assert.AnError)

		original := marshalDurableSyncPushResponse
		t.Cleanup(func() { marshalDurableSyncPushResponse = original })
		marshalDurableSyncPushResponse = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
		require.ErrorContains(t, repo.SaveSyncPushResult(ctx, "user", "key", SyncPushResponse{}), "encode durable")
	})
}
