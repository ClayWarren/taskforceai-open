package developer

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type timestampArgMatcher struct {
	expected time.Time
}

func (m timestampArgMatcher) Match(v any) bool {
	ts, ok := v.(pgtype.Timestamp)
	return ok && ts.Valid && ts.Time.Equal(m.expected)
}

type mockDeveloperWriteStore struct {
	RevokeActiveAPIKeyFunc       func(ctx context.Context, keyID int32) (bool, error)
	CreateAPIKeyWithUserLockFunc func(ctx context.Context, input createAPIKeyStoreInput, maxActiveKeys int32) error
}

func (m *mockDeveloperWriteStore) RevokeActiveAPIKey(ctx context.Context, keyID int32) (bool, error) {
	if m.RevokeActiveAPIKeyFunc != nil {
		return m.RevokeActiveAPIKeyFunc(ctx, keyID)
	}
	return true, nil
}

func (m *mockDeveloperWriteStore) CreateAPIKeyWithUserLock(ctx context.Context, input createAPIKeyStoreInput, maxActiveKeys int32) error {
	if m.CreateAPIKeyWithUserLockFunc != nil {
		return m.CreateAPIKeyWithUserLockFunc(ctx, input, maxActiveKeys)
	}
	return nil
}

type mockDeveloperQuerySource struct {
	GetUserByIDFunc            func(ctx context.Context, userID int32) (db.User, error)
	CreateAPIKeyFunc           func(ctx context.Context, input db.CreateAPIKeyParams) (db.DeveloperApiKey, error)
	GetAPIKeysByUserFunc       func(ctx context.Context, userID int32) ([]db.DeveloperApiKey, error)
	CountActiveKeysForUserFunc func(ctx context.Context, userID int32) (int32, error)
	GetAPIKeyByIDAndUserFunc   func(ctx context.Context, input db.GetAPIKeyByIDAndUserParams) (db.DeveloperApiKey, error)
	RevokeAPIKeyFunc           func(ctx context.Context, keyID int32) error
	GetAPIUsageInWindowFunc    func(ctx context.Context, input db.GetAPIUsageInWindowParams) (int32, error)
	GetAPIUsageSinceFunc       func(ctx context.Context, input db.GetAPIUsageSinceParams) ([]db.DeveloperApiUsage, error)
}

func (m *mockDeveloperQuerySource) GetUserByID(ctx context.Context, userID int32) (db.User, error) {
	if m.GetUserByIDFunc != nil {
		return m.GetUserByIDFunc(ctx, userID)
	}
	return db.User{}, nil
}

func (m *mockDeveloperQuerySource) CreateAPIKey(ctx context.Context, input db.CreateAPIKeyParams) (db.DeveloperApiKey, error) {
	if m.CreateAPIKeyFunc != nil {
		return m.CreateAPIKeyFunc(ctx, input)
	}
	return db.DeveloperApiKey{}, nil
}

func (m *mockDeveloperQuerySource) GetAPIKeysByUser(ctx context.Context, userID int32) ([]db.DeveloperApiKey, error) {
	if m.GetAPIKeysByUserFunc != nil {
		return m.GetAPIKeysByUserFunc(ctx, userID)
	}
	return nil, nil
}

func (m *mockDeveloperQuerySource) CountActiveKeysForUser(ctx context.Context, userID int32) (int32, error) {
	if m.CountActiveKeysForUserFunc != nil {
		return m.CountActiveKeysForUserFunc(ctx, userID)
	}
	return 0, nil
}

func (m *mockDeveloperQuerySource) GetAPIKeyByIDAndUser(ctx context.Context, input db.GetAPIKeyByIDAndUserParams) (db.DeveloperApiKey, error) {
	if m.GetAPIKeyByIDAndUserFunc != nil {
		return m.GetAPIKeyByIDAndUserFunc(ctx, input)
	}
	return db.DeveloperApiKey{}, nil
}

func (m *mockDeveloperQuerySource) RevokeAPIKey(ctx context.Context, keyID int32) error {
	if m.RevokeAPIKeyFunc != nil {
		return m.RevokeAPIKeyFunc(ctx, keyID)
	}
	return nil
}

func (m *mockDeveloperQuerySource) GetAPIUsageInWindow(ctx context.Context, input db.GetAPIUsageInWindowParams) (int32, error) {
	if m.GetAPIUsageInWindowFunc != nil {
		return m.GetAPIUsageInWindowFunc(ctx, input)
	}
	return 0, nil
}

func (m *mockDeveloperQuerySource) GetAPIUsageSince(ctx context.Context, input db.GetAPIUsageSinceParams) ([]db.DeveloperApiUsage, error) {
	if m.GetAPIUsageSinceFunc != nil {
		return m.GetAPIUsageSinceFunc(ctx, input)
	}
	return nil, nil
}

func recordLastUsedAt(row developerAPIKeyRow) *time.Time {
	if !row.LastUsedAt.Valid {
		return nil
	}
	return &row.LastUsedAt.Time
}

func TestMapDbKeyToRecord(t *testing.T) {
	now := time.Now()
	key := developerAPIKeyRow{
		ID:           5,
		DisplayKey:   "tfai_xxx",
		Tier:         DeveloperApiTier("pro"),
		RateLimit:    500,
		MonthlyQuota: 10000,
		CreatedAt:    pgtype.Timestamp{Time: now, Valid: true},
		LastUsedAt:   pgtype.Timestamp{Time: now, Valid: true},
		RevokedAt:    pgtype.Timestamp{Valid: false},
	}
	record := mapDbKeyToRecord(&key)

	assert.Equal(t, 5, record.ID)
	assert.Equal(t, "tfai_xxx", record.DisplayKey)
	assert.Equal(t, DeveloperApiTier("pro"), record.Tier)
	assert.Equal(t, 500, record.RateLimit)
	assert.NotNil(t, record.LastUsedAt)
	assert.Nil(t, record.RevokedAt)
}

func TestMapDbKeyToRecord_CreatedAtInvalid(t *testing.T) {
	now := time.Now()
	key := developerAPIKeyRow{
		ID:           5,
		DisplayKey:   "tfai_xxx",
		Tier:         DeveloperApiTier("pro"),
		RateLimit:    500,
		MonthlyQuota: 10000,
		CreatedAt:    pgtype.Timestamp{Valid: false},
		LastUsedAt:   pgtype.Timestamp{Time: now, Valid: true},
		RevokedAt:    pgtype.Timestamp{Valid: false},
	}
	record := mapDbKeyToRecord(&key)

	assert.Equal(t, 5, record.ID)
	assert.True(t, record.CreatedAt.IsZero())
}

func TestMapDbKeyToRecord_RevokedAt(t *testing.T) {
	now := time.Now()
	key := developerAPIKeyRow{
		ID:           5,
		DisplayKey:   "tfai_xxx",
		Tier:         DeveloperApiTier("pro"),
		RateLimit:    500,
		MonthlyQuota: 10000,
		CreatedAt:    pgtype.Timestamp{Time: now, Valid: true},
		RevokedAt:    pgtype.Timestamp{Time: now, Valid: true},
	}

	record := mapDbKeyToRecord(&key)

	require.NotNil(t, record.RevokedAt)
	assert.Equal(t, now, *record.RevokedAt)
}

func TestPgDeveloperRepository_CountActiveKeysForUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(3)))

	count, err := repo.CountActiveKeysForUser(context.Background(), 100)

	require.NoError(t, err)
	assert.Equal(t, 3, count)
}

func TestPgDeveloperRepository_CountActiveKeysForUser_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	count, err := repo.CountActiveKeysForUser(context.Background(), math.MaxInt32+1)

	require.Error(t, err)
	assert.Equal(t, 0, count)
}

func TestPgDeveloperRepository_CountActiveKeysForUser_QueryError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnError(errors.New("generic query error"))

	count, err := repo.CountActiveKeysForUser(context.Background(), 100)

	require.Error(t, err)
	assert.Equal(t, 0, count)
}

func TestPgDeveloperRepository_CreateApiKey(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(
			int32(100), "keyhash", "tfai_xxx", pgxmock.AnyArg(),
			db.DeveloperApiTier("starter"), int32(100), int32(1000),
		).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 100, KeyHash: "keyhash", DisplayKey: "tfai_xxx",
			Tier: db.DeveloperApiTier("starter"),
		}))

	err := repo.CreateApiKey(context.Background(), 100, "keyhash", "tfai_xxx", "starter", 100, 1000)

	assert.NoError(t, err)
}

func TestPgDeveloperRepository_CreateApiKey_DatabaseEnabled(t *testing.T) {
	mockQS := &mockDeveloperQuerySource{}
	repo := NewDeveloperRepositoryFromSource(mockQS)
	repo.hasDatabaseURL = func() bool { return true }
	repo.writeStore = &mockDeveloperWriteStore{
		CreateAPIKeyWithUserLockFunc: func(ctx context.Context, input createAPIKeyStoreInput, maxActiveKeys int32) error {
			if input.UserID == 999 {
				return errors.New("lock error")
			}
			return nil
		},
	}

	err := repo.CreateApiKey(context.Background(), math.MaxInt32+1, "hash", "display", DeveloperApiTier("starter"), 100, 1000)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "user_id exceeds int32 range")

	err = repo.CreateApiKey(context.Background(), 999, "hash", "display", DeveloperApiTier("starter"), 100, 1000)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "lock error")

	err = repo.CreateApiKey(context.Background(), 111, "hash", "display", DeveloperApiTier("starter"), 100, 1000)
	assert.NoError(t, err)
}

func TestPgDeveloperRepository_FindKeyForUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	now := time.Now()
	mock.ExpectQuery("SELECT (.+) FROM developer_api_keys WHERE id").
		WithArgs(int32(5), int32(100)).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 5, UserID: 100, KeyHash: "hash", DisplayKey: "tfai_xxx",
			Tier:      db.DeveloperApiTier("starter"),
			CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
		}))

	key, err := repo.FindKeyForUser(context.Background(), 5, 100)

	require.NoError(t, err)
	require.NotNil(t, key)
	assert.Equal(t, 5, key.ID)
}

func TestPgDeveloperRepository_FindKeyForUser_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT (.+) FROM developer_api_keys WHERE id").
		WithArgs(int32(5), int32(100)).
		WillReturnError(assert.AnError)

	key, err := repo.FindKeyForUser(context.Background(), 5, 100)

	require.Error(t, err)
	assert.Nil(t, key)
}

func TestPgDeveloperRepository_FindKeyForUser_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT (.+) FROM developer_api_keys WHERE id").
		WithArgs(int32(999), int32(100)).
		WillReturnError(pgx.ErrNoRows)

	key, err := repo.FindKeyForUser(context.Background(), 999, 100)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "NOT_FOUND")
	assert.Nil(t, key)
}
