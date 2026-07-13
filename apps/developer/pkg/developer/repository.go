package developer

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"os"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/convert"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type developerStore interface {
	GetAPIKeysByUser(ctx context.Context, userID int32) ([]developerAPIKeyRow, error)
	CountActiveKeysForUser(ctx context.Context, userID int32) (int32, error)
	GetAPIKeyByIDAndUser(ctx context.Context, input keyLookupInput) (developerAPIKeyRow, error)
	RevokeAPIKey(ctx context.Context, keyID int32) error
	CreateAPIKey(ctx context.Context, input createAPIKeyStoreInput) (developerAPIKeyRow, error)
	GetAPIUsageInWindow(ctx context.Context, input usageWindowInput) (int32, error)
	GetAPIUsageTotalsForKey(ctx context.Context, input usageTotalsInput) (UsageTotals, error)
	GetAPIUsageSince(ctx context.Context, input usageHistoryInput) ([]developerAPIUsageRow, error)
}

type DeveloperQuerySource interface {
	GetUserByID(ctx context.Context, userID int32) (db.User, error)
	CreateAPIKey(ctx context.Context, input db.CreateAPIKeyParams) (db.DeveloperApiKey, error)
	GetAPIKeysByUser(ctx context.Context, userID int32) ([]db.DeveloperApiKey, error)
	CountActiveKeysForUser(ctx context.Context, userID int32) (int32, error)
	GetAPIKeyByIDAndUser(ctx context.Context, input db.GetAPIKeyByIDAndUserParams) (db.DeveloperApiKey, error)
	RevokeAPIKey(ctx context.Context, keyID int32) error
	GetAPIUsageInWindow(ctx context.Context, input db.GetAPIUsageInWindowParams) (int32, error)
	GetAPIUsageSince(ctx context.Context, input db.GetAPIUsageSinceParams) ([]db.DeveloperApiUsage, error)
}

type developerWriteStore interface {
	RevokeActiveAPIKey(ctx context.Context, keyID int32) (bool, error)
	CreateAPIKeyWithUserLock(ctx context.Context, input createAPIKeyStoreInput, maxActiveKeys int32) error
}

type developerExecStore interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type developerDBProvider interface {
	GetDB() db.DBTX
}

type developerWritePool interface {
	developerExecStore
	postgres.Transactor
}

var getDeveloperWritePool = func(ctx context.Context) (developerWritePool, error) {
	return postgres.GetPool(ctx)
}

type sqlcDeveloperStore struct {
	q DeveloperQuerySource
}

type sqlcDeveloperWriteStore struct{}

type createAPIKeyStoreInput struct {
	UserID       int32
	KeyHash      string
	DisplayKey   string
	Tier         DeveloperApiTier
	RateLimit    int32
	MonthlyQuota int32
}

type keyLookupInput struct {
	ID     int32
	UserID int32
}

type developerAPIKeyRow struct {
	ID           int32
	DisplayKey   string
	Tier         DeveloperApiTier
	RateLimit    int32
	MonthlyQuota int32
	CreatedAt    pgtype.Timestamp
	RevokedAt    pgtype.Timestamp
	LastUsedAt   pgtype.Timestamp
}

type usageWindowInput struct {
	APIKeyID    int32
	WindowStart pgtype.Timestamp
	WindowEnd   pgtype.Timestamp
}

type usageTotalsInput struct {
	APIKeyID     int32
	StartOfHour  pgtype.Timestamp
	EndOfHour    pgtype.Timestamp
	StartOfDay   pgtype.Timestamp
	EndOfDay     pgtype.Timestamp
	StartOfWeek  pgtype.Timestamp
	EndOfWeek    pgtype.Timestamp
	StartOfMonth pgtype.Timestamp
	EndOfMonth   pgtype.Timestamp
}

type usageHistoryInput struct {
	KeyIDs      []int32
	WindowStart pgtype.Timestamp
}

type developerAPIUsageRow struct {
	WindowStart pgtype.Timestamp
	Count       int32
}

func (s sqlcDeveloperStore) CreateAPIKey(ctx context.Context, input createAPIKeyStoreInput) (developerAPIKeyRow, error) {
	row, err := s.q.CreateAPIKey(ctx, createAPIKeyParams(input))
	if err != nil {
		return developerAPIKeyRow{}, err
	}

	return developerAPIKeyRowFromDB(row), nil
}

func (s sqlcDeveloperStore) GetAPIKeysByUser(ctx context.Context, userID int32) ([]developerAPIKeyRow, error) {
	rows, err := s.q.GetAPIKeysByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	return collections.Map(rows, developerAPIKeyRowFromDB), nil
}

func (s sqlcDeveloperStore) CountActiveKeysForUser(ctx context.Context, userID int32) (int32, error) {
	return s.q.CountActiveKeysForUser(ctx, userID)
}

func (s sqlcDeveloperStore) GetAPIKeyByIDAndUser(ctx context.Context, input keyLookupInput) (developerAPIKeyRow, error) {
	row, err := s.q.GetAPIKeyByIDAndUser(ctx, db.GetAPIKeyByIDAndUserParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
	if err != nil {
		return developerAPIKeyRow{}, err
	}

	return developerAPIKeyRowFromDB(row), nil
}

func (s sqlcDeveloperStore) RevokeAPIKey(ctx context.Context, keyID int32) error {
	return s.q.RevokeAPIKey(ctx, keyID)
}

func (s sqlcDeveloperStore) GetAPIUsageInWindow(ctx context.Context, input usageWindowInput) (int32, error) {
	return s.q.GetAPIUsageInWindow(ctx, db.GetAPIUsageInWindowParams{
		ApiKeyID:      input.APIKeyID,
		WindowStart:   input.WindowStart,
		WindowStart_2: input.WindowEnd,
	})
}

const getAPIUsageTotalsForKeyQuery = `
SELECT
	COALESCE(SUM(count) FILTER (WHERE window_start >= $2 AND window_start < $3), 0)::int AS hourly_count,
	COALESCE(SUM(count) FILTER (WHERE window_start >= $4 AND window_start < $5), 0)::int AS daily_count,
	COALESCE(SUM(count) FILTER (WHERE window_start >= $6 AND window_start < $7), 0)::int AS weekly_count,
	COALESCE(SUM(count) FILTER (WHERE window_start >= $8 AND window_start < $9), 0)::int AS monthly_count
FROM developer_api_usage
WHERE api_key_id = $1
	AND window_start >= LEAST($2, $4, $6, $8)
	AND window_start < GREATEST($3, $5, $7, $9)
`

func (s sqlcDeveloperStore) GetAPIUsageTotalsForKey(ctx context.Context, input usageTotalsInput) (UsageTotals, error) {
	provider, ok := s.q.(developerDBProvider)
	if !ok || provider.GetDB() == nil {
		return s.getAPIUsageTotalsForKeyFallback(ctx, input)
	}

	row := provider.GetDB().QueryRow(
		ctx,
		getAPIUsageTotalsForKeyQuery,
		input.APIKeyID,
		input.StartOfHour,
		input.EndOfHour,
		input.StartOfDay,
		input.EndOfDay,
		input.StartOfWeek,
		input.EndOfWeek,
		input.StartOfMonth,
		input.EndOfMonth,
	)

	var hourlyCount, dailyCount, weeklyCount, monthlyCount int32
	if err := row.Scan(&hourlyCount, &dailyCount, &weeklyCount, &monthlyCount); err != nil {
		return UsageTotals{}, err
	}

	return UsageTotals{
		Hourly:  int(hourlyCount),
		Daily:   int(dailyCount),
		Weekly:  int(weeklyCount),
		Monthly: int(monthlyCount),
	}, nil
}

func (s sqlcDeveloperStore) getAPIUsageTotalsForKeyFallback(ctx context.Context, input usageTotalsInput) (UsageTotals, error) {
	totals := UsageTotals{}
	for _, window := range []struct {
		start, end pgtype.Timestamp
		count      *int
	}{
		{input.StartOfMonth, input.EndOfMonth, &totals.Monthly},
		{input.StartOfWeek, input.EndOfWeek, &totals.Weekly},
		{input.StartOfDay, input.EndOfDay, &totals.Daily},
		{input.StartOfHour, input.EndOfHour, &totals.Hourly},
	} {
		count, err := s.GetAPIUsageInWindow(ctx, usageWindowInput{
			APIKeyID: input.APIKeyID, WindowStart: window.start, WindowEnd: window.end,
		})
		if err != nil {
			return UsageTotals{}, err
		}
		*window.count = int(count)
	}
	return totals, nil
}

func (s sqlcDeveloperStore) GetAPIUsageSince(ctx context.Context, input usageHistoryInput) ([]developerAPIUsageRow, error) {
	rows, err := s.q.GetAPIUsageSince(ctx, db.GetAPIUsageSinceParams{
		Column1:     input.KeyIDs,
		WindowStart: input.WindowStart,
	})
	if err != nil {
		return nil, err
	}

	return collections.Map(rows, developerAPIUsageRowFromDB), nil
}

func (sqlcDeveloperWriteStore) RevokeActiveAPIKey(ctx context.Context, keyID int32) (bool, error) {
	pool, err := getDeveloperWritePool(ctx)
	if err != nil {
		return false, err
	}

	return revokeActiveAPIKey(ctx, pool, keyID)
}

func revokeActiveAPIKey(ctx context.Context, execer developerExecStore, keyID int32) (bool, error) {
	tag, err := execer.Exec(
		ctx,
		"UPDATE developer_api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
		keyID,
	)
	if err != nil {
		return false, err
	}

	return tag.RowsAffected() > 0, nil
}

func (sqlcDeveloperWriteStore) CreateAPIKeyWithUserLock(
	ctx context.Context,
	input createAPIKeyStoreInput,
	maxActiveKeys int32,
) error {
	pool, err := getDeveloperWritePool(ctx)
	if err != nil {
		return err
	}

	return createAPIKeyWithUserLock(ctx, pool, input, maxActiveKeys)
}

func createAPIKeyWithUserLock(
	ctx context.Context,
	pool postgres.Transactor,
	input createAPIKeyStoreInput,
	maxActiveKeys int32,
) error {
	return postgres.WithTx(ctx, pool, func(tx pgx.Tx) error {
		var lockedUserID int32
		if err := tx.QueryRow(ctx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", input.UserID).Scan(&lockedUserID); err != nil {
			return err
		}

		var activeCount int32
		if err := tx.QueryRow(ctx, "SELECT COUNT(*)::int FROM developer_api_keys WHERE user_id = $1 AND revoked_at IS NULL", input.UserID).Scan(&activeCount); err != nil {
			return err
		}
		if activeCount >= maxActiveKeys {
			return ErrKeyLimitReached
		}

		_, err := db.New(tx).CreateAPIKey(ctx, createAPIKeyParams(input))
		return err
	})
}

// Ensure implementations satisfy interfaces
var (
	_ DeveloperRepository = (*PgDeveloperRepository)(nil)
)

type PgDeveloperRepository struct {
	store          developerStore
	writeStore     developerWriteStore
	hasDatabaseURL func() bool
}

func NewDeveloperRepositoryFromSource(q DeveloperQuerySource) *PgDeveloperRepository {
	return &PgDeveloperRepository{
		store:      sqlcDeveloperStore{q: q},
		writeStore: sqlcDeveloperWriteStore{},
		hasDatabaseURL: func() bool {
			return os.Getenv("DATABASE_URL") != ""
		},
	}
}

func (r *PgDeveloperRepository) ListKeysForUser(ctx context.Context, userID int) ([]DeveloperApiKeyRecord, error) {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return nil, err
	}
	keys, err := r.store.GetAPIKeysByUser(ctx, dbUserID)
	if err != nil {
		return nil, err
	}

	return collections.Map(keys, func(k developerAPIKeyRow) DeveloperApiKeyRecord {
		return mapDbKeyToRecord(&k)
	}), nil
}

func (r *PgDeveloperRepository) CountActiveKeysForUser(ctx context.Context, userID int) (int, error) {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return 0, err
	}
	count, err := r.store.CountActiveKeysForUser(ctx, dbUserID)
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (r *PgDeveloperRepository) FindKeyForUser(ctx context.Context, keyID, userID int) (*DeveloperApiKeyRecord, error) {
	dbKeyID, err := convert.Int32(keyID, "key_id")
	if err != nil {
		return nil, err
	}
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return nil, err
	}
	key, err := r.store.GetAPIKeyByIDAndUser(ctx, keyLookupInput{
		ID:     dbKeyID,
		UserID: dbUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrKeyNotFound
		}
		return nil, err
	}
	rec := mapDbKeyToRecord(&key)
	return &rec, nil
}

func (r *PgDeveloperRepository) RevokeKey(ctx context.Context, keyID int) error {
	dbKeyID, err := convert.Int32(keyID, "key_id")
	if err != nil {
		return err
	}

	// In production, perform conditional revoke so concurrent requests do not
	// both succeed after a stale pre-check.
	if r.hasDatabaseURL() {
		revoked, err := r.writeStore.RevokeActiveAPIKey(ctx, dbKeyID)
		if err != nil {
			return err
		}
		if !revoked {
			return ErrKeyAlreadyRevoked
		}
		return nil
	}

	return r.store.RevokeAPIKey(ctx, dbKeyID)
}

func (r *PgDeveloperRepository) CreateApiKey(ctx context.Context, userID int, keyHash, displayKey string, tier DeveloperApiTier, rateLimit, monthlyQuota int) error {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return err
	}
	params := createAPIKeyStoreInput{
		UserID:       dbUserID,
		KeyHash:      keyHash,
		DisplayKey:   displayKey,
		Tier:         tier,
		RateLimit:    convert.ClampInt32(rateLimit),
		MonthlyQuota: convert.ClampInt32(monthlyQuota),
	}

	// Use a per-user transaction lock when running against a real DB to avoid
	// races where concurrent requests exceed the active key limit.
	if r.hasDatabaseURL() {
		return r.writeStore.CreateAPIKeyWithUserLock(ctx, params, MaxActiveKeysPerUser)
	}

	_, err = r.store.CreateAPIKey(ctx, params)
	return err
}

func (r *PgDeveloperRepository) GetUsageTotalsForKey(ctx context.Context, keyID int, startOfHour, startOfDay, startOfWeek, startOfMonth time.Time) (UsageTotals, error) {
	dbKeyID, err := convert.Int32(keyID, "key_id")
	if err != nil {
		return UsageTotals{}, err
	}

	return r.store.GetAPIUsageTotalsForKey(ctx, usageTotalsInput{
		APIKeyID:     dbKeyID,
		StartOfHour:  pgtype.Timestamp{Time: startOfHour, Valid: true},
		EndOfHour:    pgtype.Timestamp{Time: startOfHour.Add(time.Hour), Valid: true},
		StartOfDay:   pgtype.Timestamp{Time: startOfDay, Valid: true},
		EndOfDay:     pgtype.Timestamp{Time: startOfDay.AddDate(0, 0, 1), Valid: true},
		StartOfWeek:  pgtype.Timestamp{Time: startOfWeek, Valid: true},
		EndOfWeek:    pgtype.Timestamp{Time: startOfWeek.AddDate(0, 0, 7), Valid: true},
		StartOfMonth: pgtype.Timestamp{Time: startOfMonth, Valid: true},
		EndOfMonth:   pgtype.Timestamp{Time: startOfMonth.AddDate(0, 1, 0), Valid: true},
	})
}

func (r *PgDeveloperRepository) ListUsageHistory(ctx context.Context, keyIDs []int, since time.Time) ([]UsageHistoryRecord, error) {
	keyIDs32, err := convert.Int32Slice(keyIDs, "key_id")
	if err != nil {
		return nil, err
	}

	usage, err := r.store.GetAPIUsageSince(ctx, usageHistoryInput{
		KeyIDs:      keyIDs32,
		WindowStart: pgtype.Timestamp{Time: since, Valid: true},
	})
	if err != nil {
		return nil, err
	}

	return collections.Map(usage, func(u developerAPIUsageRow) UsageHistoryRecord {
		return UsageHistoryRecord{
			WindowStart: u.WindowStart.Time,
			Count:       int(u.Count),
		}
	}), nil
}

func mapDbKeyToRecord(k *developerAPIKeyRow) DeveloperApiKeyRecord {
	var lastUsedAt *time.Time
	if k.LastUsedAt.Valid {
		lastUsedAt = &k.LastUsedAt.Time
	}
	var revokedAt *time.Time
	if k.RevokedAt.Valid {
		revokedAt = &k.RevokedAt.Time
	}
	var createdAt time.Time
	if k.CreatedAt.Valid {
		createdAt = k.CreatedAt.Time
	}

	return DeveloperApiKeyRecord{
		ID:           int(k.ID),
		DisplayKey:   k.DisplayKey,
		Tier:         k.Tier,
		RateLimit:    int(k.RateLimit),
		MonthlyQuota: int(k.MonthlyQuota),
		CreatedAt:    createdAt,
		LastUsedAt:   lastUsedAt,
		RevokedAt:    revokedAt,
	}
}

func developerAPIKeyRowFromDB(row db.DeveloperApiKey) developerAPIKeyRow {
	return developerAPIKeyRow{
		ID:           row.ID,
		DisplayKey:   row.DisplayKey,
		Tier:         DeveloperApiTier(row.Tier),
		RateLimit:    row.RateLimit,
		MonthlyQuota: row.MonthlyQuota,
		CreatedAt:    row.CreatedAt,
		RevokedAt:    row.RevokedAt,
		LastUsedAt:   row.LastUsedAt,
	}
}

func developerAPIUsageRowFromDB(row db.DeveloperApiUsage) developerAPIUsageRow {
	return developerAPIUsageRow{
		WindowStart: row.WindowStart,
		Count:       row.Count,
	}
}

func createAPIKeyParams(input createAPIKeyStoreInput) db.CreateAPIKeyParams {
	return db.CreateAPIKeyParams{
		UserID:       input.UserID,
		KeyHash:      input.KeyHash,
		DisplayKey:   input.DisplayKey,
		Name:         nil,
		Tier:         db.DeveloperApiTier(input.Tier),
		RateLimit:    input.RateLimit,
		MonthlyQuota: input.MonthlyQuota,
	}
}
