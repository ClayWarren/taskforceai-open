package dbauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	corepayments "github.com/TaskForceAI/core/pkg/payments"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type apiKeyAuthError struct {
	status  int
	message string
	err     error
}

func (e *apiKeyAuthError) Error() string {
	return e.message
}

func apiKeyTier(record db.GetAPIKeyWithUserByHashRow) string {
	if tier := strings.TrimSpace(string(record.Tier)); tier != "" {
		return tier
	}
	if tier := strings.TrimSpace(string(record.UserApiTier)); tier != "" {
		return tier
	}
	return string(corepayments.DeveloperAPITierStarter)
}

func apiKeyHourlyLimit(record db.GetAPIKeyWithUserByHashRow) int {
	return corepayments.DeveloperAPIHourlyLimit(apiKeyTier(record), int(record.RateLimit))
}

func promoteAdminFromEnv(ctx context.Context, q *db.Queries, email string, alreadyAdmin bool) bool {
	if alreadyAdmin {
		return false
	}
	adminEmails := os.Getenv("ADMIN_EMAILS")
	if adminEmails == "" {
		return false
	}
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	for adminEmail := range strings.SplitSeq(adminEmails, ",") {
		if strings.ToLower(strings.TrimSpace(adminEmail)) == normalizedEmail {
			updateAdminPromotion(ctx, q, email)
			return true
		}
	}
	return false
}

func updateAdminPromotion(ctx context.Context, q *db.Queries, email string) {
	if q == nil {
		return
	}
	if _, err := q.UpdateUserAdminByEmail(ctx, db.UpdateUserAdminByEmailParams{
		Email:   email,
		IsAdmin: true,
	}); err != nil {
		slog.Error("Failed to promote user to admin in DB", "email", email, "error", err)
		return
	}
	slog.Info("Promoted user to admin via ADMIN_EMAILS", "email", email)
}

func apiKeyMonthlyQuota(record db.GetAPIKeyWithUserByHashRow) int {
	return corepayments.DeveloperAPIMonthlyQuota(
		apiKeyTier(record),
		int(record.MonthlyQuota),
		int(record.UserApiRequestsLimit),
	)
}

func lookupAPIKey(ctx context.Context, q *db.Queries, apiKey string) (db.GetAPIKeyWithUserByHashRow, *apiKeyAuthError) {
	hash := sha256.Sum256([]byte(apiKey))
	keyHash := hex.EncodeToString(hash[:])
	keyRecord, err := q.GetAPIKeyWithUserByHash(ctx, keyHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.GetAPIKeyWithUserByHashRow{}, &apiKeyAuthError{status: http.StatusUnauthorized, message: "Invalid or missing API key"}
		}
		return db.GetAPIKeyWithUserByHashRow{}, &apiKeyAuthError{
			status:  http.StatusServiceUnavailable,
			message: "Authentication backend unavailable",
			err:     err,
		}
	}
	if keyRecord.UserID < 0 {
		return db.GetAPIKeyWithUserByHashRow{}, &apiKeyAuthError{
			status:  http.StatusUnauthorized,
			message: "Invalid or missing API key",
			err:     fmt.Errorf("negative user id %d", keyRecord.UserID),
		}
	}
	if keyRecord.UserDisabled {
		return db.GetAPIKeyWithUserByHashRow{}, &apiKeyAuthError{status: http.StatusForbidden, message: "Account disabled"}
	}
	return keyRecord, nil
}

func apiKeyUser(keyRecord db.GetAPIKeyWithUserByHashRow) *auth.AuthenticatedUser {
	return &auth.AuthenticatedUser{
		ID:   int(keyRecord.UserID),
		Plan: &keyRecord.UserPlan,
	}
}

func validateAPIKeyIdentity(ctx context.Context, q *db.Queries, apiKey string) (*auth.AuthenticatedUser, *apiKeyAuthError) {
	keyRecord, authErr := lookupAPIKey(ctx, q, apiKey)
	if authErr != nil {
		return nil, authErr
	}
	return apiKeyUser(keyRecord), nil
}

func authenticateAPIKey(ctx context.Context, q *db.Queries, apiKey string) (*auth.AuthenticatedUser, *apiKeyAuthError) {
	keyRecord, authErr := lookupAPIKey(ctx, q, apiKey)
	if authErr != nil {
		return nil, authErr
	}
	if authErr := enforceAPIKeyQuota(ctx, q, keyRecord); authErr != nil {
		return nil, authErr
	}
	return apiKeyUser(keyRecord), nil
}

func enforceAPIKeyQuota(ctx context.Context, q *db.Queries, record db.GetAPIKeyWithUserByHashRow) *apiKeyAuthError {
	now := time.Now().UTC()
	monthlyQuota := apiKeyMonthlyQuota(record)
	periodExpired := !record.UserApiCurrentPeriodEnd.Valid || now.After(record.UserApiCurrentPeriodEnd.Time)

	if !periodExpired && int(record.UserApiRequestsUsed) >= monthlyQuota {
		return &apiKeyAuthError{
			status:  http.StatusTooManyRequests,
			message: "Developer API monthly quota exceeded",
		}
	}

	windowStart := now.Truncate(time.Hour)
	windowEnd := windowStart.Add(time.Hour)
	periodEnd := now.Add(30 * 24 * time.Hour)
	hourlyLimit := apiKeyHourlyLimit(record)
	quotaOK, usageOK, err := consumeAPIKeyQuota(ctx, q, consumeAPIKeyQuotaParams{
		UserID:       record.UserID,
		MonthlyQuota: int32(monthlyQuota), // #nosec G115 -- monthlyQuota comes from int32-backed DB fields or bounded tier defaults.
		APIKeyID:     record.ID,
		WindowStart:  pgtype.Timestamp{Time: windowStart, Valid: true},
		WindowEnd:    pgtype.Timestamp{Time: windowEnd, Valid: true},
		HourlyLimit:  int32(hourlyLimit), // #nosec G115 -- hourlyLimit comes from int32-backed DB fields or bounded tier defaults.
		PeriodStart:  pgtype.Timestamp{Time: now, Valid: true},
		PeriodEnd:    pgtype.Timestamp{Time: periodEnd, Valid: true},
	})
	if err != nil {
		return &apiKeyAuthError{
			status:  http.StatusServiceUnavailable,
			message: "Developer API rate limiter unavailable",
			err:     err,
		}
	}
	if !quotaOK {
		return &apiKeyAuthError{
			status:  http.StatusTooManyRequests,
			message: "Developer API monthly quota exceeded",
		}
	}
	if !usageOK {
		return &apiKeyAuthError{
			status:  http.StatusTooManyRequests,
			message: "Developer API hourly rate limit exceeded",
		}
	}

	if err := q.UpdateAPIKeyLastUsed(ctx, record.ID); err != nil {
		slog.Warn("Failed to update developer API key last-used timestamp", "keyId", record.ID, "error", err)
	}

	return nil
}

type consumeAPIKeyQuotaParams struct {
	UserID       int32
	MonthlyQuota int32
	APIKeyID     int32
	WindowStart  pgtype.Timestamp
	WindowEnd    pgtype.Timestamp
	HourlyLimit  int32
	PeriodStart  pgtype.Timestamp
	PeriodEnd    pgtype.Timestamp
}

// #nosec G101 -- SQL query text; api_key_id is a column name, not a credential.
const consumeAPIKeyQuotaSQL = `-- name: ConsumeAPIKeyQuota :one
	WITH locked_user AS (
	    SELECT
	        id,
	        CASE
	            WHEN api_current_period_end IS NULL OR $7 > api_current_period_end THEN 0
	            ELSE api_requests_used
	        END AS effective_requests_used,
	        CASE
	            WHEN api_current_period_end IS NULL OR $7 > api_current_period_end THEN $7
	            ELSE api_current_period_start
	        END AS next_period_start,
	        CASE
	            WHEN api_current_period_end IS NULL OR $7 > api_current_period_end THEN $8
	            ELSE api_current_period_end
	        END AS next_period_end
	    FROM users
	    WHERE id = $1
	    FOR UPDATE
	),
	quota_candidate AS (
	    SELECT id, effective_requests_used, next_period_start, next_period_end
	    FROM locked_user
	    WHERE effective_requests_used < $2
	),
	usage AS (
    INSERT INTO developer_api_usage (
        api_key_id, window_start, window_end, count, updated_at
    )
    SELECT $3, $4, $5, 1, NOW()
    WHERE EXISTS (SELECT 1 FROM quota_candidate)
    ON CONFLICT (api_key_id, window_start)
    DO UPDATE SET count = developer_api_usage.count + 1, updated_at = NOW()
    WHERE developer_api_usage.count < $6
    RETURNING count
),
	quota_user AS (
	    UPDATE users
	    SET
	        api_requests_used = quota_candidate.effective_requests_used + 1,
	        api_current_period_start = quota_candidate.next_period_start,
	        api_current_period_end = quota_candidate.next_period_end
	    FROM quota_candidate
	    WHERE users.id = quota_candidate.id
	        AND EXISTS (SELECT 1 FROM usage)
	    RETURNING api_requests_used
	)
SELECT
    EXISTS (SELECT 1 FROM quota_candidate) AS quota_ok,
    EXISTS (SELECT 1 FROM usage) AS usage_ok
`

func consumeAPIKeyQuota(
	ctx context.Context,
	q *db.Queries,
	arg consumeAPIKeyQuotaParams,
) (bool, bool, error) {
	var quotaOK bool
	var usageOK bool
	err := q.GetDB().QueryRow(
		ctx,
		consumeAPIKeyQuotaSQL,
		arg.UserID,
		arg.MonthlyQuota,
		arg.APIKeyID,
		arg.WindowStart,
		arg.WindowEnd,
		arg.HourlyLimit,
		arg.PeriodStart,
		arg.PeriodEnd,
	).Scan(&quotaOK, &usageOK)
	return quotaOK, usageOK, err
}

// WithAuthDB is middleware that validates auth and fetches full user from DB.
// It also handles optional organization scoping via the X-Org-ID header.
func WithAuthDB(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if q == nil {
			slog.Error("WithAuthDB: queries are not configured")
			handler.JSONError(w, http.StatusInternalServerError, "Authentication backend unavailable")
			return
		}

		token := handler.ExtractToken(r)
		if token == "" {
			handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		claims, err := auth.ValidateToken(token)
		if err != nil {
			slog.Warn("WithAuthDB: Invalid token", "error", err)
			handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
			return
		}
		if handler.IsMFAPendingClaims(claims) {
			slog.Warn("WithAuthDB: MFA pending token rejected from authenticated service path")
			handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
			return
		}
		if handler.IsTokenRevoked != nil && handler.IsTokenRevoked(r.Context(), token) {
			slog.Warn("WithAuthDB: Revoked token")
			handler.JSONError(w, http.StatusUnauthorized, "Token revoked")
			return
		}

		email, _ := claims["email"].(string)
		if email == "" {
			slog.Warn("WithAuthDB: Invalid token claims, missing email")
			handler.JSONError(w, http.StatusUnauthorized, "Invalid token claims")
			return
		}

		dbUser, err := q.GetUserByEmail(r.Context(), email)
		if err != nil {
			slog.Warn("WithAuthDB: User not found in DB", "email", email, "error", err)
			handler.JSONError(w, http.StatusUnauthorized, "User not found")
			return
		}

		if dbUser.ID < 0 {
			slog.Warn("WithAuthDB: Invalid negative user ID", "email", email, "userId", dbUser.ID)
			handler.JSONError(w, http.StatusUnauthorized, "Invalid user ID")
			return
		}

		if dbUser.Disabled {
			slog.Warn("WithAuthDB: Account disabled", "email", email, "userId", dbUser.ID)
			handler.JSONError(w, http.StatusForbidden, "Account disabled")
			return
		}

		isAdmin := dbUser.IsAdmin
		// Initial promotion via env var
		if promoteAdminFromEnv(r.Context(), q, email, isAdmin) {
			isAdmin = true
		}

		user := &auth.AuthenticatedUser{
			ID:               int(dbUser.ID),
			Email:            dbUser.Email,
			FullName:         dbUser.FullName,
			Plan:             &dbUser.Plan,
			IsAdmin:          isAdmin,
			QuickModeEnabled: dbUser.QuickModeEnabled,
		}

		// Enterprise: Extract Org IDs from claims if present
		var claimsOrgID int
		if val, ok := claims["org_id"].(float64); ok {
			claimsOrgID = int(val)
			if claimsOrgID < 0 {
				slog.Warn("WithAuthDB: Invalid negative organization ID", "email", email, "orgId", claimsOrgID)
				handler.JSONError(w, http.StatusUnauthorized, "Invalid organization ID")
				return
			}
			user.OrgID = &claimsOrgID
		}
		if val, ok := claims["workos_org_id"].(string); ok {
			user.WorkosOrgID = &val
		}
		if val, ok := claims["act_as"].(string); ok {
			user.ImpersonatorID = &val
		}

		ctx := context.WithValue(r.Context(), handler.UserContextKey, user)
		ctx = context.WithValue(ctx, handler.UserIDContextKey, int(dbUser.ID))
		if issuedAt, ok := handler.TokenIssuedAtUnixFromClaims(claims); ok {
			ctx = context.WithValue(ctx, handler.TokenIssuedAtContextKey, issuedAt)
		}

		// Handle Organization Scope (header override, fallback to claim-derived org)
		requestedOrgID := r.Header.Get("X-Org-ID")
		if requestedOrgID == "" && user.OrgID != nil {
			requestedOrgID = strconv.Itoa(*user.OrgID)
		}
		scopedCtx, err := withOrganizationScope(ctx, q, dbUser.ID, requestedOrgID)
		if err != nil {
			slog.Warn("WithAuthDB: Organization scope access denied", "userId", dbUser.ID, "orgId", requestedOrgID, "error", err)
			handler.JSONError(w, http.StatusForbidden, "You are not a member of this organization")
			return
		}
		ctx = scopedCtx

		next(w, r.WithContext(ctx))
	}
}

// WithOptionalDBAuth validates a session token, loads the DB user, and
// populates auth context only for active users. Invalid, revoked, missing, or
// disabled users proceed unauthenticated.
func WithOptionalDBAuth(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
	if q == nil {
		return next
	}
	return withOptionalSession(q, next, optionalSessionPolicy{name: "WithOptionalDBAuth", hydrate: true})
}

func WithLazyOptionalDBAuth(
	getQueries func(context.Context) (*db.Queries, error),
	next http.HandlerFunc,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if getQueries == nil {
			handler.WithOptionalAuth(next).ServeHTTP(w, r)
			return
		}
		q, err := getQueries(r.Context())
		if err != nil {
			handler.WithOptionalAuth(next).ServeHTTP(w, r)
			return
		}
		WithOptionalDBAuth(q, next).ServeHTTP(w, r)
	}
}

// WithFlexibleAuth supports both standard session tokens and API keys.
func WithFlexibleAuth(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
	session := withOptionalSession(q, next, optionalSessionPolicy{
		name: "WithFlexibleAuth", promoteAdmin: true, setAuthMethod: true,
	})
	return func(w http.ResponseWriter, r *http.Request) {
		if q == nil {
			slog.Error("WithFlexibleAuth: queries are not configured")
			next(w, r)
			return
		}

		// API Key check
		if apiKey := r.Header.Get("x-api-key"); apiKey != "" {
			user, apiKeyErr := authenticateAPIKey(r.Context(), q, apiKey)
			if apiKeyErr == nil {
				ctx := context.WithValue(r.Context(), handler.UserContextKey, user)
				ctx = context.WithValue(ctx, handler.UserIDContextKey, user.ID)
				ctx = context.WithValue(ctx, handler.AuthMethodContextKey, handler.AuthMethodAPIKey)
				next(w, r.WithContext(ctx))
				return
			}
			if apiKeyErr.status != http.StatusUnauthorized {
				slog.Warn("WithFlexibleAuth: API key rejected", "status", apiKeyErr.status, "error", apiKeyErr.err)
				handler.JSONError(w, apiKeyErr.status, apiKeyErr.message)
				return
			}
		}

		session.ServeHTTP(w, r)
	}
}

type optionalSessionPolicy struct {
	name                  string
	hydrate, promoteAdmin bool
	setAuthMethod         bool
}

func withOptionalSession(q *db.Queries, next http.HandlerFunc, policy optionalSessionPolicy) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := handler.ExtractToken(r)
		if token == "" {
			next(w, r)
			return
		}
		claims, err := auth.ValidateToken(token)
		if err != nil || handler.IsMFAPendingClaims(claims) ||
			(handler.IsTokenRevoked != nil && handler.IsTokenRevoked(r.Context(), token)) {
			next(w, r)
			return
		}

		user, err := handler.BuildAuthenticatedUser(claims)
		if err != nil || (policy.hydrate && strings.TrimSpace(user.Email) == "") {
			next(w, r)
			return
		}
		dbUser, err := q.GetUserByEmail(r.Context(), user.Email)
		if err != nil || dbUser.Disabled || dbUser.ID < 0 {
			next(w, r)
			return
		}

		user.ID = int(dbUser.ID)
		user.IsAdmin = dbUser.IsAdmin
		user.QuickModeEnabled = dbUser.QuickModeEnabled
		if policy.hydrate {
			user.Email, user.FullName, user.Plan = dbUser.Email, dbUser.FullName, &dbUser.Plan
		}
		if policy.promoteAdmin && promoteAdminFromEnv(r.Context(), q, user.Email, user.IsAdmin) {
			user.IsAdmin = true
		}

		ctx := context.WithValue(r.Context(), handler.UserContextKey, user)
		ctx = context.WithValue(ctx, handler.UserIDContextKey, int(dbUser.ID))
		ctx = context.WithValue(ctx, handler.EmailContextKey, dbUser.Email)
		if policy.setAuthMethod {
			ctx = context.WithValue(ctx, handler.AuthMethodContextKey, handler.AuthMethodSession)
		}
		if issuedAt, ok := handler.TokenIssuedAtUnixFromClaims(claims); ok {
			ctx = context.WithValue(ctx, handler.TokenIssuedAtContextKey, issuedAt)
		}

		requestedOrgID := r.Header.Get("X-Org-ID")
		if requestedOrgID == "" && user.OrgID != nil {
			requestedOrgID = strconv.Itoa(*user.OrgID)
		}
		ctx, err = withOrganizationScope(ctx, q, dbUser.ID, requestedOrgID)
		if err != nil {
			slog.Warn(policy.name+": Organization scope access denied", "userId", dbUser.ID, "orgId", requestedOrgID, "error", err)
			handler.JSONError(w, http.StatusForbidden, "You are not a member of this organization")
			return
		}
		next(w, r.WithContext(ctx))
	}
}

// WithAPIKey is middleware that validates the request has a valid API key.
func WithAPIKey(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
	return withAPIKeyAuthenticator(q, next, authenticateAPIKey)
}

// WithAPIKeyIdentity validates an API key and installs its user identity without
// consuming hourly or monthly quota. It is intended for a proxy boundary where
// the downstream service will authenticate the forwarded key and own quota
// enforcement for the request.
func WithAPIKeyIdentity(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
	return withAPIKeyAuthenticator(q, next, validateAPIKeyIdentity)
}

type apiKeyAuthenticator func(context.Context, *db.Queries, string) (*auth.AuthenticatedUser, *apiKeyAuthError)

func withAPIKeyAuthenticator(q *db.Queries, next http.HandlerFunc, authenticate apiKeyAuthenticator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if q == nil {
			slog.Error("WithAPIKey: queries are not configured")
			handler.JSONError(w, http.StatusInternalServerError, "Authentication backend unavailable")
			return
		}

		apiKey := r.Header.Get("x-api-key")
		if apiKey == "" {
			handler.JSONError(w, http.StatusUnauthorized, "Invalid or missing API key")
			return
		}

		user, apiKeyErr := authenticate(r.Context(), q, apiKey)
		if apiKeyErr != nil {
			slog.Warn("WithAPIKey: API key rejected", "status", apiKeyErr.status, "error", apiKeyErr.err)
			handler.JSONError(w, apiKeyErr.status, apiKeyErr.message)
			return
		}
		ctx := context.WithValue(r.Context(), handler.UserContextKey, user)
		ctx = context.WithValue(ctx, handler.UserIDContextKey, user.ID)
		ctx = context.WithValue(ctx, handler.AuthMethodContextKey, handler.AuthMethodAPIKey)

		next(w, r.WithContext(ctx))
	}
}

func withOrganizationScope(ctx context.Context, q *db.Queries, userID int32, orgIDStr string) (context.Context, error) {
	if orgIDStr == "" {
		return ctx, nil
	}
	if q == nil {
		return ctx, fmt.Errorf("queries are not configured")
	}

	orgID, err := strconv.Atoi(orgIDStr)
	if err != nil {
		return ctx, fmt.Errorf("invalid organization id %q: %w", orgIDStr, err)
	}
	if orgID <= 0 || orgID > math.MaxInt32 {
		return ctx, fmt.Errorf("invalid organization id %q", orgIDStr)
	}

	membership, err := q.GetMembership(ctx, db.GetMembershipParams{
		OrganizationID: int32(orgID), // #nosec G109 G115
		UserID:         userID,
	})
	if err != nil {
		return ctx, fmt.Errorf("verify membership for org %d and user %d: %w", orgID, userID, err)
	}

	scopedCtx := context.WithValue(ctx, handler.OrgIDContextKey, int(membership.OrganizationID))
	return scopedCtx, nil
}
