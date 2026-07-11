package dbauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const middlewareTestSecret = "middleware-test-secret-32-characters"

type middlewareAPIUsageCall struct {
	apiKeyID    int32
	windowStart pgtype.Timestamp
	windowEnd   pgtype.Timestamp
	count       int32
}

type middlewareFakeDB struct {
	usersByEmail      map[string]User
	userErrorsByEmail map[string]error

	membershipByKey  map[string]Membership
	membershipErrors map[string]error

	apiKeysByHash map[string]GetAPIKeyWithUserByHashRow
	apiKeyErrors  map[string]error

	apiUsageByKey            map[int32]int32
	getAPIUsageInWindowErr   error
	apiUsageErr              error
	apiUsageCalls            []middlewareAPIUsageCall
	updateAPIKeyLastUsedErr  error
	updateAPIKeyLastUsedCall []int32
	forceConsumeQuotaOK      *bool
	forceConsumeUsageOK      *bool
	incrementQuotaErr        error
	incrementQuotaCalls      []int32

	updateUserAdminErr   error
	updateUserAdminCalls []UpdateUserAdminByEmailParams
}

func newMiddlewareFakeDB() *middlewareFakeDB {
	return &middlewareFakeDB{
		usersByEmail:      map[string]User{},
		userErrorsByEmail: map[string]error{},
		membershipByKey:   map[string]Membership{},
		membershipErrors:  map[string]error{},
		apiKeysByHash:     map[string]GetAPIKeyWithUserByHashRow{},
		apiKeyErrors:      map[string]error{},
		apiUsageByKey:     map[int32]int32{},
	}
}

func (f *middlewareFakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	switch {
	case strings.Contains(sql, "UpdateAPIKeyLastUsed"):
		if len(args) != 1 {
			return pgconn.CommandTag{}, fmt.Errorf("UpdateAPIKeyLastUsed expected 1 arg, got %d", len(args))
		}
		apiKeyID, ok := args[0].(int32)
		if !ok {
			return pgconn.CommandTag{}, fmt.Errorf("UpdateAPIKeyLastUsed expected int32 api key id arg")
		}
		if f.updateAPIKeyLastUsedErr != nil {
			return pgconn.CommandTag{}, f.updateAPIKeyLastUsedErr
		}
		f.updateAPIKeyLastUsedCall = append(f.updateAPIKeyLastUsedCall, apiKeyID)
		return pgconn.CommandTag{}, nil
	case strings.Contains(sql, "UPDATE users SET api_requests_used = api_requests_used + 1"):
		if len(args) != 1 {
			return pgconn.CommandTag{}, fmt.Errorf("quota increment expected 1 arg, got %d", len(args))
		}
		userID, ok := args[0].(int32)
		if !ok {
			return pgconn.CommandTag{}, fmt.Errorf("quota increment expected int32 user id arg")
		}
		if f.incrementQuotaErr != nil {
			return pgconn.CommandTag{}, f.incrementQuotaErr
		}
		f.incrementQuotaCalls = append(f.incrementQuotaCalls, userID)
		for hash, record := range f.apiKeysByHash {
			if record.UserID == userID {
				record.UserApiRequestsUsed++
				f.apiKeysByHash[hash] = record
			}
		}
		return pgconn.CommandTag{}, nil
	default:
		return pgconn.CommandTag{}, fmt.Errorf("unexpected Exec call")
	}
}

func (f *middlewareFakeDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, fmt.Errorf("unexpected Query call")
}

func (f *middlewareFakeDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "GetUserByEmail"):
		if len(args) != 1 {
			return middlewareErrRow{err: fmt.Errorf("GetUserByEmail expected 1 arg, got %d", len(args))}
		}
		email, ok := args[0].(string)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("GetUserByEmail expected string arg")}
		}
		if err, ok := f.userErrorsByEmail[email]; ok {
			return middlewareErrRow{err: err}
		}
		user, ok := f.usersByEmail[email]
		if !ok {
			return middlewareErrRow{err: pgx.ErrNoRows}
		}
		return middlewareUserRow{user: user}

	case strings.Contains(sql, "UpdateUserAdminByEmail"):
		if len(args) != 2 {
			return middlewareErrRow{err: fmt.Errorf("UpdateUserAdminByEmail expected 2 args, got %d", len(args))}
		}
		email, ok := args[0].(string)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("UpdateUserAdminByEmail expected email string arg")}
		}
		isAdmin, ok := args[1].(bool)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("UpdateUserAdminByEmail expected bool arg")}
		}

		f.updateUserAdminCalls = append(f.updateUserAdminCalls, UpdateUserAdminByEmailParams{
			Email:   email,
			IsAdmin: isAdmin,
		})
		if f.updateUserAdminErr != nil {
			return middlewareErrRow{err: f.updateUserAdminErr}
		}

		user := f.usersByEmail[email]
		user.Email = email
		user.IsAdmin = isAdmin
		f.usersByEmail[email] = user
		return middlewareUserRow{user: user}

	case strings.Contains(sql, "GetMembership"):
		if len(args) != 2 {
			return middlewareErrRow{err: fmt.Errorf("GetMembership expected 2 args, got %d", len(args))}
		}
		orgID, ok := args[0].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("GetMembership expected int32 org id arg")}
		}
		userID, ok := args[1].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("GetMembership expected int32 user id arg")}
		}

		key := membershipLookupKey(orgID, userID)
		if err, ok := f.membershipErrors[key]; ok {
			return middlewareErrRow{err: err}
		}
		membership, ok := f.membershipByKey[key]
		if !ok {
			return middlewareErrRow{err: pgx.ErrNoRows}
		}
		return middlewareMembershipRow{membership: membership}

	case strings.Contains(sql, "GetAPIKeyWithUserByHash"):
		if len(args) != 1 {
			return middlewareErrRow{err: fmt.Errorf("GetAPIKeyWithUserByHash expected 1 arg, got %d", len(args))}
		}
		hash, ok := args[0].(string)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("GetAPIKeyWithUserByHash expected string hash arg")}
		}
		if err, ok := f.apiKeyErrors[hash]; ok {
			return middlewareErrRow{err: err}
		}
		record, ok := f.apiKeysByHash[hash]
		if !ok {
			return middlewareErrRow{err: pgx.ErrNoRows}
		}
		return middlewareAPIKeyRow{record: record}
	case strings.Contains(sql, "ConsumeAPIKeyQuota"):
		if len(args) != 8 {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected 8 args, got %d", len(args))}
		}
		userID, ok := args[0].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected int32 user id arg")}
		}
		monthlyQuota, ok := args[1].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected int32 monthly quota arg")}
		}
		apiKeyID, ok := args[2].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected int32 api key id arg")}
		}
		windowStart, ok := args[3].(pgtype.Timestamp)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected timestamp window start arg")}
		}
		windowEnd, ok := args[4].(pgtype.Timestamp)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected timestamp window end arg")}
		}
		hourlyLimit, ok := args[5].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected int32 hourly limit arg")}
		}
		periodStart, ok := args[6].(pgtype.Timestamp)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected timestamp period start arg")}
		}
		periodEnd, ok := args[7].(pgtype.Timestamp)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("ConsumeAPIKeyQuota expected timestamp period end arg")}
		}
		if f.incrementQuotaErr != nil {
			return middlewareErrRow{err: f.incrementQuotaErr}
		}
		if f.apiUsageErr != nil {
			return middlewareErrRow{err: f.apiUsageErr}
		}
		if f.forceConsumeQuotaOK != nil || f.forceConsumeUsageOK != nil {
			quotaOK := true
			if f.forceConsumeQuotaOK != nil {
				quotaOK = *f.forceConsumeQuotaOK
			}
			usageOK := true
			if f.forceConsumeUsageOK != nil {
				usageOK = *f.forceConsumeUsageOK
			}
			return middlewareBoolPairRow{first: quotaOK, second: usageOK}
		}

		var currentUserHash string
		var currentUserRecord GetAPIKeyWithUserByHashRow
		for hash, record := range f.apiKeysByHash {
			if record.UserID == userID {
				currentUserHash = hash
				currentUserRecord = record
				break
			}
		}
		if currentUserHash != "" && (!currentUserRecord.UserApiCurrentPeriodEnd.Valid || periodStart.Time.After(currentUserRecord.UserApiCurrentPeriodEnd.Time)) {
			currentUserRecord.UserApiRequestsUsed = 0
		}
		if currentUserHash == "" || currentUserRecord.UserApiRequestsUsed >= monthlyQuota {
			return middlewareBoolPairRow{first: false, second: false}
		}
		if f.apiUsageByKey[apiKeyID] >= hourlyLimit {
			return middlewareBoolPairRow{first: true, second: false}
		}

		f.incrementQuotaCalls = append(f.incrementQuotaCalls, userID)
		for hash, record := range f.apiKeysByHash {
			if record.UserID == userID {
				if !record.UserApiCurrentPeriodEnd.Valid || periodStart.Time.After(record.UserApiCurrentPeriodEnd.Time) {
					record.UserApiRequestsUsed = 0
					record.UserApiCurrentPeriodEnd = periodEnd
				}
				record.UserApiRequestsUsed++
				f.apiKeysByHash[hash] = record
			}
		}
		f.apiUsageCalls = append(f.apiUsageCalls, middlewareAPIUsageCall{
			apiKeyID:    apiKeyID,
			windowStart: windowStart,
			windowEnd:   windowEnd,
			count:       1,
		})
		f.apiUsageByKey[apiKeyID]++
		return middlewareBoolPairRow{first: true, second: true}
	case strings.Contains(sql, "GetAPIUsageInWindow"):
		if len(args) != 3 {
			return middlewareErrRow{err: fmt.Errorf("GetAPIUsageInWindow expected 3 args, got %d", len(args))}
		}
		apiKeyID, ok := args[0].(int32)
		if !ok {
			return middlewareErrRow{err: fmt.Errorf("GetAPIUsageInWindow expected int32 api key id arg")}
		}
		if f.getAPIUsageInWindowErr != nil {
			return middlewareErrRow{err: f.getAPIUsageInWindowErr}
		}
		return middlewareInt32Row{value: f.apiUsageByKey[apiKeyID]}
	default:
		return middlewareErrRow{err: fmt.Errorf("unexpected QueryRow sql: %s", sql)}
	}
}

type middlewareErrRow struct {
	err error
}

func (r middlewareErrRow) Scan(...any) error {
	return r.err
}

type middlewareUserRow struct {
	user User
}

func (r middlewareUserRow) Scan(dest ...any) error {
	if len(dest) < 15 {
		return fmt.Errorf("expected at least 15 destinations for User scan, got %d", len(dest))
	}
	if err := assignScanDest(dest, 0, r.user.ID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 1, r.user.Email); err != nil {
		return err
	}
	if err := assignScanDest(dest, 2, r.user.FullName); err != nil {
		return err
	}
	if err := assignScanDest(dest, 3, r.user.Disabled); err != nil {
		return err
	}
	if err := assignScanDest(dest, 10, r.user.QuickModeEnabled); err != nil {
		return err
	}
	if err := assignScanDest(dest, 11, r.user.MfaEnabled); err != nil {
		return err
	}
	if err := assignScanDest(dest, 12, r.user.MfaTotpSecret); err != nil {
		return err
	}
	if err := assignScanDest(dest, 13, r.user.MfaVerifiedAt); err != nil {
		return err
	}
	if err := assignScanDest(dest, 14, r.user.Plan); err != nil {
		return err
	}
	if err := assignScanDest(dest, 17, r.user.IsAdmin); err != nil {
		return err
	}

	return nil
}

type middlewareMembershipRow struct {
	membership Membership
}

func (r middlewareMembershipRow) Scan(dest ...any) error {
	if len(dest) < 6 {
		return fmt.Errorf("expected 6 destinations for Membership scan, got %d", len(dest))
	}
	if err := assignScanDest(dest, 0, r.membership.ID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 1, r.membership.OrganizationID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 2, r.membership.UserID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 3, r.membership.Role); err != nil {
		return err
	}
	if err := assignScanDest(dest, 4, r.membership.CreatedAt); err != nil {
		return err
	}
	if err := assignScanDest(dest, 5, r.membership.UpdatedAt); err != nil {
		return err
	}

	return nil
}

type middlewareAPIKeyRow struct {
	record GetAPIKeyWithUserByHashRow
}

func (r middlewareAPIKeyRow) Scan(dest ...any) error {
	if len(dest) < 12 {
		return fmt.Errorf("expected 12 destinations for API key scan, got %d", len(dest))
	}
	if err := assignScanDest(dest, 0, r.record.ID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 1, r.record.UserID); err != nil {
		return err
	}
	if err := assignScanDest(dest, 2, r.record.KeyHash); err != nil {
		return err
	}
	if err := assignScanDest(dest, 3, r.record.Tier); err != nil {
		return err
	}
	if err := assignScanDest(dest, 4, r.record.RateLimit); err != nil {
		return err
	}
	if err := assignScanDest(dest, 5, r.record.MonthlyQuota); err != nil {
		return err
	}
	if err := assignScanDest(dest, 6, r.record.RevokedAt); err != nil {
		return err
	}
	if err := assignScanDest(dest, 7, r.record.UserDisabled); err != nil {
		return err
	}
	if err := assignScanDest(dest, 8, r.record.UserApiTier); err != nil {
		return err
	}
	if err := assignScanDest(dest, 9, r.record.UserApiRequestsLimit); err != nil {
		return err
	}
	if err := assignScanDest(dest, 10, r.record.UserApiRequestsUsed); err != nil {
		return err
	}
	if err := assignScanDest(dest, 11, r.record.UserApiCurrentPeriodEnd); err != nil {
		return err
	}

	return nil
}

type middlewareInt32Row struct {
	value int32
}

func (r middlewareInt32Row) Scan(dest ...any) error {
	if len(dest) != 1 {
		return fmt.Errorf("expected 1 destination for int32 scan, got %d", len(dest))
	}
	return assignScanDest(dest, 0, r.value)
}

type middlewareBoolPairRow struct {
	first  bool
	second bool
}

func (r middlewareBoolPairRow) Scan(dest ...any) error {
	if len(dest) != 2 {
		return fmt.Errorf("expected 2 destinations for bool pair scan, got %d", len(dest))
	}
	if err := assignScanDest(dest, 0, r.first); err != nil {
		return err
	}
	return assignScanDest(dest, 1, r.second)
}

func assignScanDest[T any](dest []any, index int, value T) error {
	target, ok := dest[index].(*T)
	if !ok {
		return fmt.Errorf("destination %d has unexpected type", index)
	}

	*target = value
	return nil
}

func mustSignToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()

	t.Setenv("AUTH_SECRET", middlewareTestSecret)
	if _, hasExp := claims["exp"]; !hasExp {
		claims["exp"] = time.Now().Add(time.Hour).Unix()
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(middlewareTestSecret))
	require.NoError(t, err)

	return signed
}

func hashAPIKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func membershipLookupKey(orgID int32, userID int32) string {
	return fmt.Sprintf("%d:%d", orgID, userID)
}

func apiKeyRecord(hash string, userID int32, disabled bool, tier DeveloperApiTier) GetAPIKeyWithUserByHashRow {
	return GetAPIKeyWithUserByHashRow{
		ID:                      1,
		UserID:                  userID,
		KeyHash:                 hash,
		Tier:                    tier,
		RateLimit:               120,
		MonthlyQuota:            10000,
		UserDisabled:            disabled,
		UserApiTier:             tier,
		UserApiRequestsLimit:    10000,
		UserApiRequestsUsed:     15,
		UserApiCurrentPeriodEnd: pgtype.Timestamp{Time: time.Now().Add(time.Hour), Valid: true},
	}
}

func TestAPIKeyAuthError(t *testing.T) {
	err := &apiKeyAuthError{message: "invalid"}
	assert.Equal(t, "invalid", err.Error())
}

func TestAPIKeyLimitHelpers(t *testing.T) {
	assert.Equal(t, string(DeveloperApiTierSTARTER), apiKeyTier(GetAPIKeyWithUserByHashRow{}))
	assert.Equal(t, "custom", apiKeyTier(GetAPIKeyWithUserByHashRow{Tier: " custom "}))
	assert.Equal(t, "pro", apiKeyTier(GetAPIKeyWithUserByHashRow{UserApiTier: " pro "}))

	assert.Equal(t, 123, apiKeyHourlyLimit(GetAPIKeyWithUserByHashRow{RateLimit: 123}))
	assert.Equal(t, 10000, apiKeyHourlyLimit(GetAPIKeyWithUserByHashRow{Tier: DeveloperApiTierENTERPRISE}))
	assert.Equal(t, 5000, apiKeyHourlyLimit(GetAPIKeyWithUserByHashRow{Tier: DeveloperApiTierPRO}))
	assert.Equal(t, 1000, apiKeyHourlyLimit(GetAPIKeyWithUserByHashRow{}))

	assert.Equal(t, 456, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{MonthlyQuota: 456}))
	assert.Equal(t, 789, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{UserApiRequestsLimit: 789}))
	assert.Equal(t, 100, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{MonthlyQuota: 10000, UserApiRequestsLimit: 100}))
	assert.Equal(t, 100000000, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{Tier: DeveloperApiTierENTERPRISE}))
	assert.Equal(t, 10000000, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{Tier: DeveloperApiTierPRO}))
	assert.Equal(t, 1000000, apiKeyMonthlyQuota(GetAPIKeyWithUserByHashRow{}))
}

func TestAdminPromotionHelpersDirectEdges(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "other@example.com")
	assert.False(t, promoteAdminFromEnv(context.Background(), nil, "user@example.com", false))

	updateAdminPromotion(context.Background(), nil, "user@example.com")
}

func TestConsumeAPIKeyQuotaRollsBackMonthlyWhenHourlyFull(t *testing.T) {
	rawKey := "hourly-full-key"
	keyHash := hashAPIKey(rawKey)

	fakeDB := newMiddlewareFakeDB()
	record := apiKeyRecord(keyHash, 75, false, DeveloperApiTierPRO)
	record.UserApiRequestsUsed = 99
	record.UserApiRequestsLimit = 100
	fakeDB.apiKeysByHash[keyHash] = record
	fakeDB.apiUsageByKey[record.ID] = record.RateLimit

	now := time.Now()
	quotaOK, usageOK, err := consumeAPIKeyQuota(context.Background(), New(fakeDB), consumeAPIKeyQuotaParams{
		UserID:       record.UserID,
		MonthlyQuota: 100,
		APIKeyID:     record.ID,
		WindowStart:  pgtype.Timestamp{Time: now.Truncate(time.Hour), Valid: true},
		WindowEnd:    pgtype.Timestamp{Time: now.Truncate(time.Hour).Add(time.Hour), Valid: true},
		HourlyLimit:  record.RateLimit,
		PeriodStart:  pgtype.Timestamp{Time: now, Valid: true},
		PeriodEnd:    pgtype.Timestamp{Time: now.Add(30 * 24 * time.Hour), Valid: true},
	})

	require.NoError(t, err)
	assert.True(t, quotaOK)
	assert.False(t, usageOK)
	assert.Equal(t, int32(99), fakeDB.apiKeysByHash[keyHash].UserApiRequestsUsed)
	assert.Empty(t, fakeDB.incrementQuotaCalls)
	assert.Empty(t, fakeDB.apiUsageCalls)
}

func TestConsumeAPIKeyQuotaSQLDoesNotUseRollbackCTE(t *testing.T) {
	assert.NotContains(t, consumeAPIKeyQuotaSQL, "undo_quota")
	assert.NotContains(t, consumeAPIKeyQuotaSQL, "api_requests_used - 1")
	assert.Contains(t, consumeAPIKeyQuotaSQL, "WHERE EXISTS (SELECT 1 FROM quota_candidate)")
	assert.Contains(t, consumeAPIKeyQuotaSQL, "AND EXISTS (SELECT 1 FROM usage)")
	assert.Contains(t, consumeAPIKeyQuotaSQL, "FOR UPDATE")
	assert.Contains(t, consumeAPIKeyQuotaSQL, "effective_requests_used")
}

func TestWithAPIKey_DisabledUserReturnsForbidden(t *testing.T) {
	assertAPIKeyRejected(t, "disabled-account-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 71, true, DeveloperApiTierPRO)
	}, http.StatusForbidden)
}

func TestWithAPIKey_LookupErrorReturnsServiceUnavailable(t *testing.T) {
	assertAPIKeyRejected(t, "lookup-error-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		fakeDB.apiKeyErrors[keyHash] = errors.New("database unavailable")
	}, http.StatusServiceUnavailable)
}

func TestValidateAPIKeyIdentityReturnsLookupError(t *testing.T) {
	const rawKey = "identity-lookup-error"
	fakeDB := newMiddlewareFakeDB()
	fakeDB.apiKeyErrors[hashAPIKey(rawKey)] = errors.New("database unavailable")

	user, authErr := validateAPIKeyIdentity(context.Background(), New(fakeDB), rawKey)
	assert.Nil(t, user)
	require.NotNil(t, authErr)
	assert.Equal(t, http.StatusServiceUnavailable, authErr.status)
}

func TestWithAPIKey_MissingOrInvalidReturnsUnauthorized(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		setupDB  func(*middlewareFakeDB)
		wantCode int
	}{
		{
			name:     "missing api key",
			wantCode: http.StatusUnauthorized,
		},
		{
			name:     "invalid api key",
			header:   "unknown-api-key",
			wantCode: http.StatusUnauthorized,
		},
		{
			name:   "negative user id from key lookup",
			header: "negative-user-id-key",
			setupDB: func(fakeDB *middlewareFakeDB) {
				hash := hashAPIKey("negative-user-id-key")
				fakeDB.apiKeysByHash[hash] = apiKeyRecord(hash, -1, false, DeveloperApiTierPRO)
			},
			wantCode: http.StatusUnauthorized,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertAPIKeyRejected(t, tc.header, func(fakeDB *middlewareFakeDB, keyHash string) {
				if tc.setupDB != nil {
					tc.setupDB(fakeDB)
				}
			}, tc.wantCode)
		})
	}
}

func TestWithAPIKey_MonthlyQuotaExceededReturnsTooManyRequests(t *testing.T) {
	rec, called, fakeDB := runAPIKeyMiddleware(t, "monthly-quota-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		record := apiKeyRecord(keyHash, 73, false, DeveloperApiTierPRO)
		record.UserApiRequestsUsed = record.MonthlyQuota
		record.UserApiCurrentPeriodEnd = pgtype.Timestamp{Time: time.Now().Add(time.Hour), Valid: true}
		fakeDB.apiKeysByHash[keyHash] = record
	}, nil)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.False(t, called)
	assert.Empty(t, fakeDB.apiUsageCalls)
	assert.Empty(t, fakeDB.incrementQuotaCalls)
}

func TestWithAPIKey_QuotaRaceReturnsTooManyRequests(t *testing.T) {
	quotaOK := false
	usageOK := true
	rec, called, _ := runAPIKeyMiddleware(t, "quota-race-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 173, false, DeveloperApiTierPRO)
		fakeDB.forceConsumeQuotaOK = &quotaOK
		fakeDB.forceConsumeUsageOK = &usageOK
	}, nil)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.False(t, called)
}

func TestWithAPIKey_NilQueriesReturnsInternalServerError(t *testing.T) {
	called := false
	middleware := WithAPIKey(nil, func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", "any-key")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.False(t, called)
}

func TestWithAPIKey_QuotaEnforcementErrors(t *testing.T) {
	tests := []struct {
		name    string
		setupDB func(*middlewareFakeDB, string)
		want    int
	}{
		{
			name: "record usage failure",
			setupDB: func(fakeDB *middlewareFakeDB, keyHash string) {
				fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 602, false, DeveloperApiTierPRO)
				fakeDB.apiUsageErr = errors.New("record failed")
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name: "increment quota failure",
			setupDB: func(fakeDB *middlewareFakeDB, keyHash string) {
				fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 603, false, DeveloperApiTierPRO)
				fakeDB.incrementQuotaErr = errors.New("increment failed")
			},
			want: http.StatusServiceUnavailable,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rawKey := "quota-error-" + tc.name
			assertAPIKeyRejected(t, rawKey, func(fakeDB *middlewareFakeDB, keyHash string) {
				tc.setupDB(fakeDB, keyHash)
			}, tc.want)
		})
	}
}

func TestWithAPIKey_ResetsExpiredQuotaPeriod(t *testing.T) {
	var usedKeyHash string
	fakeDB := assertAPIKeySuccess(t, "expired-period-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		usedKeyHash = keyHash
		record := apiKeyRecord(keyHash, 501, false, DeveloperApiTierPRO)
		record.UserApiCurrentPeriodEnd = pgtype.Timestamp{Time: time.Now().Add(-time.Hour), Valid: true}
		record.UserApiRequestsUsed = 99
		fakeDB.apiKeysByHash[keyHash] = record
	}, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	require.Len(t, fakeDB.apiUsageCalls, 1)
	require.Len(t, fakeDB.incrementQuotaCalls, 1)
	assert.Equal(t, int32(1), fakeDB.apiKeysByHash[usedKeyHash].UserApiRequestsUsed)
	assert.True(t, fakeDB.apiKeysByHash[usedKeyHash].UserApiCurrentPeriodEnd.Time.After(time.Now()))
}

func TestWithAPIKey_SetsContextValuesOnSuccess(t *testing.T) {
	assertAPIKeySuccess(t, "valid-api-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 72, false, DeveloperApiTierPRO)
	}, func(w http.ResponseWriter, r *http.Request) {
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 72, user.ID)
		if assert.NotNil(t, user.Plan) {
			assert.Equal(t, string(DeveloperApiTierPRO), *user.Plan)
		}
		assert.IsType(t, int(0), r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, 72, r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, handler.AuthMethodAPIKey, r.Context().Value(handler.AuthMethodContextKey))
		w.WriteHeader(http.StatusNoContent)
	})
}

func TestWithAPIKeyIdentity_SetsContextWithoutConsumingQuota(t *testing.T) {
	rawKey := "proxy-boundary-key"
	keyHash := hashAPIKey(rawKey)
	fakeDB := newMiddlewareFakeDB()
	record := apiKeyRecord(keyHash, 172, false, DeveloperApiTierPRO)
	record.UserApiRequestsUsed = record.MonthlyQuota
	record.UserApiCurrentPeriodEnd = pgtype.Timestamp{Time: time.Now().Add(time.Hour), Valid: true}
	fakeDB.apiKeysByHash[keyHash] = record

	called := false
	middleware := WithAPIKeyIdentity(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		if !assert.NotNil(t, user) {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		assert.Equal(t, 172, user.ID)
		assert.Equal(t, handler.AuthMethodAPIKey, r.Context().Value(handler.AuthMethodContextKey))
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/run", nil)
	req.Header.Set("x-api-key", rawKey)
	rec := httptest.NewRecorder()

	middleware(rec, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, fakeDB.apiUsageCalls)
	assert.Empty(t, fakeDB.incrementQuotaCalls)
	assert.Empty(t, fakeDB.updateAPIKeyLastUsedCall)
}

func TestWithAPIKey_UpdateLastUsedFailureStillSucceeds(t *testing.T) {
	assertAPIKeySuccess(t, "last-used-error-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 701, false, DeveloperApiTierPRO)
		fakeDB.updateAPIKeyLastUsedErr = errors.New("last used update failed")
	}, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
}

func TestWithAPIKey_UserMonthlyLimitCapsStoredKeyQuota(t *testing.T) {
	rec, called, fakeDB := runAPIKeyMiddleware(t, "downgraded-account-key", func(fakeDB *middlewareFakeDB, keyHash string) {
		record := apiKeyRecord(keyHash, 74, false, DeveloperApiTierPRO)
		record.MonthlyQuota = 10000
		record.UserApiRequestsLimit = 100
		record.UserApiRequestsUsed = 100
		record.UserApiCurrentPeriodEnd = pgtype.Timestamp{Time: time.Now().Add(time.Hour), Valid: true}
		fakeDB.apiKeysByHash[keyHash] = record
	}, nil)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.False(t, called)
	assert.Empty(t, fakeDB.apiUsageCalls)
	assert.Empty(t, fakeDB.incrementQuotaCalls)
}

func TestWithAuthDB_AdminEmailsPromotesUserAndPersists(t *testing.T) {
	email := "promote@example.com"
	t.Setenv("ADMIN_EMAILS", "other@example.com, promote@example.com")

	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:               21,
		Email:            email,
		Plan:             "pro",
		IsAdmin:          false,
		QuickModeEnabled: true,
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.True(t, user.IsAdmin)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	require.Len(t, fakeDB.updateUserAdminCalls, 1)
	assert.Equal(t, UpdateUserAdminByEmailParams{
		Email:   email,
		IsAdmin: true,
	}, fakeDB.updateUserAdminCalls[0])
}
