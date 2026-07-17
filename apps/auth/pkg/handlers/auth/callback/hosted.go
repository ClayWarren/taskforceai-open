package callback

import (
	"context"
	"errors"
	"fmt"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/authtelemetry"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	authmfa "github.com/TaskForceAI/auth-service/pkg/handlers/auth/mfa"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/jackc/pgx/v5"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

func shouldUseSecureCookies(r *http.Request) bool {
	return handler.ShouldUseSecureCookies(r)
}

type HostedHandlerStruct struct {
	WorkOS      providers.WorkOSProvider
	LinkUser    func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error)
	AuditLogger *auth.AuditService
	Limiter     *ratelimit.RedisRateLimiter
	GetQueries  func(ctx context.Context) (*db.Queries, error)
}

var getWorkOSDBPool = postgres.GetPool

func (h *HostedHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if h.writeRateLimitError(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		handler.JSONError(w, http.StatusBadRequest, "Missing code")
		return
	}

	// Verify State
	stateParam, err := verifyState(w, r)
	if err != nil {
		handler.GetLogger().Warn("Invalid OAuth state", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusBadRequest, "Invalid state parameter")
		return
	}

	// Exchange Code & Get User from WorkOS
	resp, err := h.WorkOS.AuthenticateWithCode(r.Context(), usermanagement.AuthenticateWithCodeOpts{
		ClientID: os.Getenv("WORKOS_CLIENT_ID"),
		Code:     code,
	})
	if err != nil {
		handler.GetLogger().Error("Failed to authenticate with WorkOS", map[string]any{"error": err})
		// Audit failure if we have a logger
		if h.AuditLogger != nil {
			msg := "Authentication failed"
			h.AuditLogger.LogLogin(r.Context(), nil, false, handler.GetClientIP(r), handler.GetUserAgent(r), &msg)
		}
		handler.JSONError(w, http.StatusUnauthorized, "Authentication failed")
		return
	}

	// Database Logic
	if h.LinkUser == nil {
		handler.GetLogger().Error("Hosted callback LinkUser dependency missing", nil)
		handler.JSONError(w, http.StatusInternalServerError, "Server configuration error")
		return
	}

	var q *db.Queries
	var ok bool
	q, ok = handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		return
	}

	user, err := h.LinkUser(r.Context(), q, resp.User)
	if err != nil {
		handler.GetLogger().Error("Failed to link or create user", map[string]any{"error": err.Error()})
		if h.AuditLogger != nil {
			msg := fmt.Sprintf("Account mapping failed: %v", err)
			h.AuditLogger.LogLogin(r.Context(), nil, false, handler.GetClientIP(r), handler.GetUserAgent(r), &msg)
		}
		if errors.Is(err, auth.ErrUserDisabled) {
			handler.JSONError(w, http.StatusForbidden, "Account is disabled")
			return
		}
		handler.JSONError(w, http.StatusInternalServerError, "Failed to process user account")
		return
	}

	// Session & Redirect
	sessionUser := auth.BuildSessionPayload(user)
	if resp.OrganizationID != "" {
		sessionUser.OrgID = &resp.OrganizationID
		org, orgErr := q.GetOrganizationByWorkosID(r.Context(), &resp.OrganizationID)
		if orgErr != nil {
			handler.GetLogger().Error("Failed to resolve hosted login organization", map[string]any{"workos_org": resp.OrganizationID, "error": orgErr.Error()})
			handler.JSONError(w, http.StatusServiceUnavailable, "Organization unavailable")
			return
		}
		id := int(org.ID)
		sessionUser.InternalOrgID = &id
	}

	target := determineRedirectTarget(r, stateParam)

	// Clear redirect cookie before either a full session redirect or an MFA challenge.
	domain := auth.GetCookieDomain()
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // clearing an OAuth redirect cookie requires matching the original provider cookie attributes.
		Name:     "oauth_redirect",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		Domain:   domain,
	})

	if authmfa.StartPendingWebLogin(w, r, user, sessionUser, target) {
		return
	}

	signedToken, err := auth.EncodeSessionToken(sessionUser, strings.TrimSpace(os.Getenv("AUTH_SECRET")), auth.DefaultSessionMaxAge)
	if err != nil {
		handler.GetLogger().Error("Failed to generate session token", map[string]any{"error": err})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to create session")
		return
	}

	isSecure := shouldUseSecureCookies(r)
	auth.ApplySessionCookies(w, signedToken, sessionUser, isSecure)

	// Audit successful login
	if h.AuditLogger != nil {
		h.AuditLogger.LogLogin(r.Context(), user, true, handler.GetClientIP(r), handler.GetUserAgent(r), nil)
	}

	http.Redirect(w, r, target, http.StatusTemporaryRedirect) //nolint:gosec // target comes from signed state/cookie data validated by determineRedirectTarget.
}

func (h *HostedHandlerStruct) writeRateLimitError(w http.ResponseWriter, r *http.Request) bool {
	if h.Limiter == nil {
		return false
	}
	ip := handler.GetClientIP(r)
	if ip == nil {
		return false
	}
	res, err := h.Limiter.Check(r.Context(), "callback:"+*ip, ratelimit.CallbackMaxRequests, time.Minute)
	if err != nil {
		handler.GetLogger().Warn("Rate limiter check failed for callback", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return true
	}
	if res.Allowed {
		return false
	}
	handler.GetLogger().Warn("Rate limit exceeded for callback", map[string]any{"ip": *ip})
	handler.JSONError(w, http.StatusTooManyRequests, "Too many requests")
	return true
}

func HostedHandler(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID"))
	encryptionKey := os.Getenv("ENCRYPTION_KEY")
	databaseURL := os.Getenv("DATABASE_URL")

	if clientID == "" || encryptionKey == "" || databaseURL == "" {
		errMsg := fmt.Sprintf("Missing configuration: clientID=%v, encryptionKey=%v, databaseURL=%v",
			clientID != "", len(encryptionKey) == 64, databaseURL != "")
		handler.GetLogger().Error(errMsg, nil)
		handler.JSONError(w, http.StatusInternalServerError, "Server configuration error")
		return
	}

	client := providers.NewWorkOSClient(
		strings.TrimSpace(os.Getenv("WORKOS_API_KEY")),
		clientID,
	)

	// Initialize DB if possible for audit
	var q *db.Queries
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) != "" {
		var ok bool
		q, ok = handler.RequireQueries(w, r, nil)
		if !ok {
			return
		}
	}

	// Explicitly handle nil Redis client to avoid typed-nil-in-interface issue
	var limiter *ratelimit.RedisRateLimiter
	if redisClient := handler.GetRedisClient(); redisClient != nil {
		limiter = ratelimit.NewRedisRateLimiter(redisClient, "")
	}

	h := &HostedHandlerStruct{
		WorkOS:      client,
		LinkUser:    linkOrCreateWorkOSUser,
		AuditLogger: auth.NewAuditService(auth.NewAuditLogRepository(q)),
		Limiter:     limiter,
		GetQueries:  nil,
	}
	h.ServeHTTP(w, r)
}

type TransactionManager interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func linkOrCreateWorkOSUser(ctx context.Context, q *db.Queries, workosUser usermanagement.User) (*auth.AuthUser, error) {
	if q == nil {
		return nil, os.ErrInvalid // Sanity check
	}

	// Default to shared pool if not provided via context or other means
	// For testing, we can inject a mock transaction manager
	pool, err := getWorkOSDBPool(ctx)
	if err != nil {
		return nil, err
	}

	return LinkOrCreateWorkOSUserWithTM(ctx, q, workosUser, pool)
}

// LinkOrCreateWorkOSUserWithTM handles the database transaction for linking/creating a WorkOS user.
func LinkOrCreateWorkOSUserWithTM(ctx context.Context, q *db.Queries, workosUser usermanagement.User, tm TransactionManager) (*auth.AuthUser, error) {
	txCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	tx, err := tm.Begin(txCtx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := tx.Rollback(txCtx); err != nil && err.Error() != "tx is closed" {
			handler.GetLogger().Error("Failed to rollback transaction", map[string]any{"error": err.Error()})
		}
	}()

	qtx := q.WithTx(tx)

	accountRepo := auth.NewAccountRepository(qtx)
	userRepo := auth.NewTransactionalAuthUserRepository(qtx)
	regRepo := auth.NewRegisterRepository(qtx)

	service := auth.NewLinkerService(userRepo, accountRepo, regRepo, authtelemetry.New())
	user, err := service.LinkOrCreateExternalUser(txCtx, auth.ExternalIdentity{
		Provider:   "workos",
		ProviderID: workosUser.ID,
		Email:      workosUser.Email,
		FirstName:  workosUser.FirstName,
		LastName:   workosUser.LastName,
	})
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(txCtx); err != nil {
		return nil, err
	}

	return user, nil
}
