package developer

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgDeveloperRepository_FindKeyForUser_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	key, err := repo.FindKeyForUser(context.Background(), math.MaxInt32+1, 100)
	require.Error(t, err)
	assert.Nil(t, key)

	key, err = repo.FindKeyForUser(context.Background(), 100, math.MaxInt32+1)
	require.Error(t, err)
	assert.Nil(t, key)
}

func TestPgDeveloperRepository_GetUsageTotalsForKey(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	now := time.Now()
	startOfHour := now.Truncate(time.Hour)
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startOfWeek := startOfDay.AddDate(0, 0, -int(now.Weekday()))
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	mock.ExpectQuery("SELECT COALESCE").
		WithArgs(
			int32(5),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{"hourly_count", "daily_count", "weekly_count", "monthly_count"}).AddRow(int32(5), int32(20), int32(50), int32(100)))

	totals, err := repo.GetUsageTotalsForKey(context.Background(), 5, startOfHour, startOfDay, startOfWeek, startOfMonth)

	require.NoError(t, err)
	assert.Equal(t, 5, totals.Hourly)
	assert.Equal(t, 20, totals.Daily)
	assert.Equal(t, 50, totals.Weekly)
	assert.Equal(t, 100, totals.Monthly)
}

func TestPgDeveloperRepository_GetUsageTotalsForKey_QueryError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	now := time.Now()

	mock.ExpectQuery("SELECT COALESCE").
		WithArgs(
			int32(5),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnError(errors.New("usage totals query error"))

	_, err := repo.GetUsageTotalsForKey(context.Background(), 5, now, now, now, now)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "usage totals query error")
}

func TestPgDeveloperRepository_GetUsageTotalsForKey_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	_, err := repo.GetUsageTotalsForKey(context.Background(), math.MaxInt32+1, time.Now(), time.Now(), time.Now(), time.Now())
	assert.Error(t, err)
}

func TestPgDeveloperRepository_GetUsageTotalsForKey_UsesWindowUpperBounds(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	startOfHour := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	startOfDay := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	startOfWeek := time.Date(2026, 2, 23, 0, 0, 0, 0, time.UTC)
	startOfMonth := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

	mock.ExpectQuery("SELECT COALESCE").
		WithArgs(
			int32(7),
			timestampArgMatcher{expected: startOfHour},
			timestampArgMatcher{expected: startOfHour.Add(time.Hour)},
			timestampArgMatcher{expected: startOfDay},
			timestampArgMatcher{expected: startOfDay.AddDate(0, 0, 1)},
			timestampArgMatcher{expected: startOfWeek},
			timestampArgMatcher{expected: startOfWeek.AddDate(0, 0, 7)},
			timestampArgMatcher{expected: startOfMonth},
			timestampArgMatcher{expected: startOfMonth.AddDate(0, 1, 0)},
		).
		WillReturnRows(pgxmock.NewRows([]string{"hourly_count", "daily_count", "weekly_count", "monthly_count"}).AddRow(int32(5), int32(20), int32(50), int32(100)))

	_, err := repo.GetUsageTotalsForKey(context.Background(), 7, startOfHour, startOfDay, startOfWeek, startOfMonth)

	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgDeveloperRepository_ListKeysForUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	now := time.Now()

	mock.ExpectQuery("SELECT (.+) FROM developer_api_keys WHERE user_id").
		WithArgs(int32(100)).
		WillReturnRows(dbtest.APIKeyRows(
			dbtest.APIKey{
				ID: 1, UserID: 100, KeyHash: "hash1", DisplayKey: "tfai_xxx1",
				Tier:      db.DeveloperApiTier("starter"),
				CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
			},
			dbtest.APIKey{
				ID: 2, UserID: 100, KeyHash: "hash2", DisplayKey: "tfai_xxx2",
				Tier: db.DeveloperApiTier("pro"), RateLimit: 500, MonthlyQuota: 10000,
				CreatedAt:  pgtype.Timestamp{Time: now, Valid: true},
				LastUsedAt: pgtype.Timestamp{Time: now, Valid: true},
			},
		))

	keys, err := repo.ListKeysForUser(context.Background(), 100)

	require.NoError(t, err)
	assert.Len(t, keys, 2)
	assert.Equal(t, "tfai_xxx1", keys[0].DisplayKey)
	assert.Equal(t, DeveloperApiTier("starter"), keys[0].Tier)
	assert.NotNil(t, keys[1].LastUsedAt)
}

func TestPgDeveloperRepository_ListKeysForUser_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	_, err := repo.ListKeysForUser(context.Background(), math.MaxInt32+1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgDeveloperRepository_ListKeysForUser_QueryError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT (.+) FROM developer_api_keys WHERE user_id").
		WithArgs(int32(100)).
		WillReturnError(errors.New("generic query error"))

	keys, err := repo.ListKeysForUser(context.Background(), 100)

	require.Error(t, err)
	assert.Nil(t, keys)
}

func TestPgDeveloperRepository_ListUsageHistory(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	now := time.Now()

	// Returns full DeveloperApiUsage: id, api_key_id, window_start, window_end, count, endpoint, status_code, response_time, timestamp, created_at, updated_at
	usageColumns := []string{
		"id", "api_key_id", "window_start", "window_end", "count",
		"endpoint", "status_code", "response_time", "timestamp",
		"created_at", "updated_at",
	}

	mock.ExpectQuery("SELECT (.+) FROM developer_api_usage").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(usageColumns).
			AddRow(
				int32(1), int32(1), pgtype.Timestamp{Time: now, Valid: true},
				pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true}, int64(10),
				nil, nil, nil, pgtype.Timestamp{Time: now, Valid: true},
				pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now, Valid: true},
			).
			AddRow(
				int32(2), int32(1), pgtype.Timestamp{Time: now.Add(-time.Hour), Valid: true},
				pgtype.Timestamp{Time: now, Valid: true}, int64(5),
				nil, nil, nil, pgtype.Timestamp{Time: now, Valid: true},
				pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now, Valid: true},
			))

	records, err := repo.ListUsageHistory(context.Background(), []int{1, 2, 3}, now.Add(-24*time.Hour))

	require.NoError(t, err)
	assert.Len(t, records, 2)
	assert.Equal(t, 10, records[0].Count)
}

func TestPgDeveloperRepository_ListUsageHistory_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	_, err := repo.ListUsageHistory(context.Background(), []int{1, math.MaxInt32 + 1}, time.Now())
	assert.Error(t, err)
}

func TestPgDeveloperRepository_ListUsageHistory_QueryError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectQuery("SELECT (.+) FROM developer_api_usage").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("generic query error"))

	_, err := repo.ListUsageHistory(context.Background(), []int{1, 2}, time.Now())
	assert.Error(t, err)
}

func TestPgDeveloperRepository_RevokeKey(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	mock.ExpectExec("UPDATE developer_api_keys SET revoked_at").
		WithArgs(int32(5)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.RevokeKey(context.Background(), 5)

	assert.NoError(t, err)
}

func TestPgDeveloperRepository_RevokeKey_DatabaseEnabled(t *testing.T) {
	mockQS := &mockDeveloperQuerySource{}
	repo := NewDeveloperRepositoryFromSource(mockQS)

	// Override database check and inject mock writeStore
	repo.hasDatabaseURL = func() bool { return true }

	mockWS := &mockDeveloperWriteStore{
		RevokeActiveAPIKeyFunc: func(ctx context.Context, keyID int32) (bool, error) {
			if keyID == 999 {
				return false, errors.New("revoke error")
			}
			if keyID == 888 {
				return false, nil // already revoked
			}
			return true, nil
		},
	}
	repo.writeStore = mockWS

	// Test key range error
	err := repo.RevokeKey(context.Background(), math.MaxInt32+1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "key_id exceeds int32 range")

	// Test database error path
	err = repo.RevokeKey(context.Background(), 999)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "revoke error")

	// Test already revoked path
	err = repo.RevokeKey(context.Background(), 888)
	require.ErrorIs(t, err, ErrKeyAlreadyRevoked)

	// Test success path
	err = repo.RevokeKey(context.Background(), 111)
	assert.NoError(t, err)
}

func TestPgDeveloperRepository_RevokeKey_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewDeveloperRepositoryFromSource(queries)

	err := repo.RevokeKey(context.Background(), math.MaxInt32+1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestSqlcDeveloperStore_CreateAPIKey(t *testing.T) {
	now := time.Now()
	mockQS := &mockDeveloperQuerySource{
		CreateAPIKeyFunc: func(ctx context.Context, input db.CreateAPIKeyParams) (db.DeveloperApiKey, error) {
			if input.UserID == 999 {
				return db.DeveloperApiKey{}, errors.New("insert failed")
			}
			return db.DeveloperApiKey{
				ID:           1,
				DisplayKey:   input.DisplayKey,
				Tier:         input.Tier,
				RateLimit:    input.RateLimit,
				MonthlyQuota: input.MonthlyQuota,
				CreatedAt:    pgtype.Timestamp{Time: now, Valid: true},
				LastUsedAt:   pgtype.Timestamp{Valid: false},
			}, nil
		},
	}

	store := sqlcDeveloperStore{q: mockQS}
	row, err := store.CreateAPIKey(context.Background(), createAPIKeyStoreInput{
		UserID:       100,
		KeyHash:      "hash",
		DisplayKey:   "tfai_xxx",
		Tier:         TierStarter,
		RateLimit:    1000,
		MonthlyQuota: 1000000,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(1), row.ID)
	assert.Nil(t, recordLastUsedAt(row))

	_, err = store.CreateAPIKey(context.Background(), createAPIKeyStoreInput{UserID: 999})
	assert.Error(t, err)
}

func TestSqlcDeveloperStore_GetAPIUsageTotalsForKeyFallback(t *testing.T) {
	// A query source without a GetDB provider forces the per-window fallback,
	// which calls GetAPIUsageInWindow once per window (monthly, weekly, daily,
	// hourly, in that order).
	newStore := func(failOn int) sqlcDeveloperStore {
		n := 0
		return sqlcDeveloperStore{q: &mockDeveloperQuerySource{
			GetAPIUsageInWindowFunc: func(context.Context, db.GetAPIUsageInWindowParams) (int32, error) {
				n++
				if n == failOn {
					return 0, errors.New("window error")
				}
				return int32(n), nil
			},
		}}
	}

	input := usageTotalsInput{APIKeyID: 5}

	// Happy path: all four windows succeed.
	totals, err := newStore(0).GetAPIUsageTotalsForKey(context.Background(), input)
	require.NoError(t, err)
	assert.Equal(t, 1, totals.Monthly)
	assert.Equal(t, 2, totals.Weekly)
	assert.Equal(t, 3, totals.Daily)
	assert.Equal(t, 4, totals.Hourly)

	// Each window's error path must short-circuit the fallback.
	for failOn := 1; failOn <= 4; failOn++ {
		_, err := newStore(failOn).GetAPIUsageTotalsForKey(context.Background(), input)
		require.Errorf(t, err, "expected error when window %d fails", failOn)
		assert.Contains(t, err.Error(), "window error")
	}
}

func TestSqlcDeveloperWriteStore_ErrorPaths(t *testing.T) {
	ws := sqlcDeveloperWriteStore{}

	// Test RevokeActiveAPIKey when GetPool fails (e.g. no DB configured)
	ok, err := ws.RevokeActiveAPIKey(context.Background(), 1)
	require.Error(t, err)
	assert.False(t, ok)

	// Test CreateAPIKeyWithUserLock when GetPool fails (e.g. no DB configured)
	err = ws.CreateAPIKeyWithUserLock(context.Background(), createAPIKeyStoreInput{}, 10)
	assert.Error(t, err)
}

func TestSqlcDeveloperWriteStore_RevokeActiveAPIKeySuccess(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	originalGetPool := getDeveloperWritePool
	getDeveloperWritePool = func(context.Context) (developerWritePool, error) {
		return mock, nil
	}
	t.Cleanup(func() { getDeveloperWritePool = originalGetPool })

	mock.ExpectExec("UPDATE developer_api_keys SET revoked_at").
		WithArgs(int32(5)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	revoked, err := sqlcDeveloperWriteStore{}.RevokeActiveAPIKey(context.Background(), 5)

	require.NoError(t, err)
	assert.True(t, revoked)
}

func TestSqlcDeveloperWriteStore_CreateAPIKeyWithUserLockSuccess(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	originalGetPool := getDeveloperWritePool
	getDeveloperWritePool = func(context.Context) (developerWritePool, error) {
		return mock, nil
	}
	t.Cleanup(func() { getDeveloperWritePool = originalGetPool })

	input := createAPIKeyStoreInput{
		UserID:       100,
		KeyHash:      "hash",
		DisplayKey:   "tfai_123",
		Tier:         TierStarter,
		RateLimit:    1000,
		MonthlyQuota: 1000000,
	}
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int32(100)))
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(100), "hash", "tfai_123", pgxmock.AnyArg(), db.DeveloperApiTier(TierStarter), int32(1000), int32(1000000)).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID:           1,
			UserID:       100,
			KeyHash:      "hash",
			DisplayKey:   "tfai_123",
			Tier:         db.DeveloperApiTier(TierStarter),
			RateLimit:    1000,
			MonthlyQuota: 1000000,
		}))
	mock.ExpectCommit()

	err := sqlcDeveloperWriteStore{}.CreateAPIKeyWithUserLock(context.Background(), input, 10)

	require.NoError(t, err)
}

func TestRevokeActiveAPIKeyExec(t *testing.T) {
	tests := []struct {
		name     string
		affected int64
		revoked  bool
	}{
		{name: "revoked", affected: 1, revoked: true},
		{name: "already revoked", affected: 0, revoked: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := dbtest.NewMockPool(t)
			mock.ExpectExec("UPDATE developer_api_keys SET revoked_at").
				WithArgs(int32(5)).
				WillReturnResult(pgxmock.NewResult("UPDATE", tc.affected))

			revoked, err := revokeActiveAPIKey(context.Background(), mock, 5)

			require.NoError(t, err)
			assert.Equal(t, tc.revoked, revoked)
		})
	}
}

func TestRevokeActiveAPIKeyExec_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	mock.ExpectExec("UPDATE developer_api_keys SET revoked_at").
		WithArgs(int32(5)).
		WillReturnError(errors.New("update failed"))

	revoked, err := revokeActiveAPIKey(context.Background(), mock, 5)

	require.Error(t, err)
	assert.False(t, revoked)
}

func TestCreateAPIKeyWithUserLock_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	input := createAPIKeyStoreInput{
		UserID:       100,
		KeyHash:      "hash",
		DisplayKey:   "tfai_123",
		Tier:         TierStarter,
		RateLimit:    1000,
		MonthlyQuota: 1000000,
	}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int32(100)))
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int32(9)))
	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(100), "hash", "tfai_123", pgxmock.AnyArg(), db.DeveloperApiTier(TierStarter), int32(1000), int32(1000000)).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID:           1,
			UserID:       100,
			KeyHash:      "hash",
			DisplayKey:   "tfai_123",
			Tier:         db.DeveloperApiTier(TierStarter),
			RateLimit:    1000,
			MonthlyQuota: 1000000,
		}))
	mock.ExpectCommit()

	err := createAPIKeyWithUserLock(context.Background(), mock, input, 10)

	require.NoError(t, err)
}

func TestCreateAPIKeyWithUserLock_UserLockError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	input := createAPIKeyStoreInput{UserID: 100}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnError(errors.New("user lock failed"))
	mock.ExpectRollback()

	err := createAPIKeyWithUserLock(context.Background(), mock, input, 10)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "user lock failed")
}

func TestCreateAPIKeyWithUserLock_ActiveCountError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	input := createAPIKeyStoreInput{UserID: 100}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int32(100)))
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnError(errors.New("count failed"))
	mock.ExpectRollback()

	err := createAPIKeyWithUserLock(context.Background(), mock, input, 10)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "count failed")
}

func TestCreateAPIKeyWithUserLock_KeyLimitReachedRollsBack(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	input := createAPIKeyStoreInput{
		UserID:       100,
		KeyHash:      "hash",
		DisplayKey:   "tfai_123",
		Tier:         TierStarter,
		RateLimit:    1000,
		MonthlyQuota: 1000000,
	}

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int32(100)))
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int32(10)))
	mock.ExpectRollback()

	err := createAPIKeyWithUserLock(context.Background(), mock, input, 10)

	require.ErrorIs(t, err, ErrKeyLimitReached)
}
