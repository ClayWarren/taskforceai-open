package saml

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
	"github.com/TaskForceAI/auth-service/pkg/handler"
	authmfa "github.com/TaskForceAI/auth-service/pkg/handlers/auth/mfa"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/jackc/pgx/v5"
	"github.com/workos/workos-go/v6/pkg/sso"
)

type CallbackHandlerStruct struct {
	WorkOS     providers.WorkOSProvider
	LinkUser   func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error)
	Limiter    *ratelimit.RedisRateLimiter
	GetQueries func(ctx context.Context) (*db.Queries, error)
}

var (
	errSAMLDatabaseConnection = errors.New("saml database connection failed")
	errSAMLOrgNotFound        = errors.New("saml organization not found")
	errSAMLEmailOrgMismatch   = errors.New("saml email domain does not match organization")
)

var (
	ensureSAMLMember       = ensureSAMLMembershipWithOrg
	encodeSAMLSessionToken = auth.EncodeSessionToken
	getSAMLDBPool          = func(ctx context.Context) (postgres.Transactor, error) {
		return postgres.GetPool(ctx)
	}
)

func (h *CallbackHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	if h.writeRateLimitError(w, r) {
		return
	}

	apiKey := os.Getenv("WORKOS_API_KEY")
	clientID := os.Getenv("WORKOS_CLIENT_ID")
	h.WorkOS.Configure(apiKey, clientID)

	code, ok := validateSAMLCallbackRequest(w, r)
	if !ok {
		return
	}

	// 1. Exchange code for profile
	profileAndToken, err := h.WorkOS.GetSSOProfileAndToken(r.Context(), sso.GetProfileAndTokenOpts{
		Code: code,
	})
	if err != nil {
		handler.GetLogger().Error("Failed to authenticate with WorkOS SSO", map[string]any{"error": err})
		handler.JSONError(w, http.StatusUnauthorized, "Failed to authenticate with WorkOS")
		return
	}

	profile := profileAndToken.Profile
	if strings.TrimSpace(profile.OrganizationID) == "" {
		handler.GetLogger().Warn("Rejected SAML login without WorkOS organization", map[string]any{"email": profile.Email})
		handler.JSONError(w, http.StatusUnauthorized, "Organization not found")
		return
	}

	// 2. Setup DB
	q, ok := handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		return
	}

	user, internalOrgID, txErr := h.linkUserAndMembership(r.Context(), q, profile)
	if txErr != nil {
		writeSAMLProvisioningError(w, profile, txErr)
		return
	}
	if user == nil {
		handler.GetLogger().Error("SAML user provisioning returned no user", map[string]any{"workos_org": profile.OrganizationID})
		handler.JSONError(w, http.StatusInternalServerError, "User provisioning failed")
		return
	}
	// 5. Create Session (JWT)
	sessionUser := auth.SessionUser{
		ID:            fmt.Sprintf("%d", user.ID),
		Email:         user.Email,
		OrgID:         &profile.OrganizationID,
		InternalOrgID: internalOrgID,
	}
	if user.FullName != nil {
		sessionUser.FullName = *user.FullName
	}

	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "https://www.taskforceai.chat"
	}
	redirectURL := appURL + "/dashboard"
	if !handler.IsAllowedRedirect(redirectURL) {
		handler.GetLogger().Error("Malicious APP_URL configured", map[string]any{"url": appURL})
		handler.JSONError(w, http.StatusInternalServerError, "Server configuration error")
		return
	}

	if authmfa.StartPendingWebLogin(w, r, user, sessionUser, redirectURL) {
		return
	}

	signedToken, err := encodeSAMLSessionToken(sessionUser, strings.TrimSpace(os.Getenv("AUTH_SECRET")), auth.DefaultSessionMaxAge)
	if err != nil {
		handler.GetLogger().Error("Failed to generate session token", map[string]any{"error": err})
		handler.JSONError(w, http.StatusInternalServerError, "Token generation failed")
		return
	}

	// 6. Set Cookies and Redirect
	auth.ApplySessionCookies(w, signedToken, sessionUser, handler.ShouldUseSecureCookies(r))

	// Audit successful login
	auditService := auth.NewAuditService(auth.NewAuditLogRepository(q))
	auditService.LogLogin(r.Context(), user, true, handler.GetClientIP(r), handler.GetUserAgent(r), nil)

	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func validateSAMLCallbackRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	code := r.URL.Query().Get("code")
	if code == "" {
		handler.JSONError(w, http.StatusBadRequest, "Authorization code missing")
		return "", false
	}
	fullState := r.URL.Query().Get("state")
	if fullState == "" {
		handler.JSONError(w, http.StatusBadRequest, "State missing")
		return "", false
	}
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie == nil || strings.TrimSpace(stateCookie.Value) == "" {
		handler.JSONError(w, http.StatusBadRequest, "Invalid state")
		return "", false
	}
	stateParam, stateTarget := fullState, ""
	if param, target, found := strings.Cut(fullState, "|"); found {
		stateParam, stateTarget = param, target
	}
	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if stateCookie.Value != stateParam || (secret == "" && handler.IsProductionEnv()) ||
		(secret != "" && !stateutil.VerifySignedState(stateParam, stateTarget, secret)) {
		handler.JSONError(w, http.StatusBadRequest, "Invalid state")
		return "", false
	}
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // clearing an OAuth state cookie requires matching the original provider cookie attributes.
		Name: "oauth_state", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true,
		SameSite: http.SameSiteNoneMode, Domain: auth.GetCookieDomain(),
	})
	return code, true
}

func (h *CallbackHandlerStruct) linkUserAndMembership(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, *int, error) {
	p, err := samlTransactor(ctx, q)
	if err != nil {
		return nil, nil, err
	}

	var user *auth.AuthUser
	var internalOrgID *int
	err = postgres.WithTx(ctx, p, func(tx pgx.Tx) error {
		txQ := q.WithTx(tx)
		linkedUser, err := h.LinkUser(ctx, txQ, profile)
		if err != nil {
			return err
		}
		if linkedUser == nil {
			return nil
		}
		user = linkedUser
		orgID, err := ensureSAMLMember(ctx, txQ, user.ID, profile.OrganizationID)
		if err != nil {
			return err
		}
		converted := int(orgID)
		internalOrgID = &converted
		return nil
	})
	return user, internalOrgID, err
}

func samlTransactor(ctx context.Context, q *db.Queries) (postgres.Transactor, error) {
	if transactor, ok := q.GetDB().(postgres.Transactor); ok {
		return transactor, nil
	}
	p, err := getSAMLDBPool(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errSAMLDatabaseConnection, err)
	}
	return p, nil
}

func writeSAMLProvisioningError(w http.ResponseWriter, profile sso.Profile, err error) {
	if errors.Is(err, errSAMLDatabaseConnection) {
		handler.JSONError(w, http.StatusInternalServerError, "Database connection failed")
		return
	}
	if errors.Is(err, errSAMLOrgNotFound) {
		handler.GetLogger().Warn("Organization not found for SAML login", map[string]any{"workos_org": profile.OrganizationID})
		handler.JSONError(w, http.StatusUnauthorized, "Organization not found")
		return
	}
	if errors.Is(err, errSAMLEmailOrgMismatch) {
		handler.GetLogger().Warn("Rejected SAML login with mismatched email domain", map[string]any{
			"domain":     samlEmailDomain(profile.Email),
			"workos_org": profile.OrganizationID,
		})
		handler.JSONError(w, http.StatusUnauthorized, "Organization not found")
		return
	}
	if errors.Is(err, auth.ErrUserDisabled) {
		handler.JSONError(w, http.StatusForbidden, "Account is disabled")
		return
	}
	handler.GetLogger().Error("Failed SAML user+membership transaction", map[string]any{"error": err.Error()})
	handler.JSONError(w, http.StatusInternalServerError, "User provisioning failed")
}

func (h *CallbackHandlerStruct) writeRateLimitError(w http.ResponseWriter, r *http.Request) bool {
	if h.Limiter == nil {
		return false
	}
	ip := handler.GetClientIP(r)
	if ip == nil {
		return false
	}
	res, err := h.Limiter.Check(r.Context(), "saml:"+*ip, ratelimit.SAMLMaxRequests, time.Minute)
	if err != nil {
		handler.GetLogger().Warn("Rate limiter check failed for saml", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return true
	}
	if res.Allowed {
		return false
	}
	handler.GetLogger().Warn("Rate limit exceeded for saml", map[string]any{"ip": *ip})
	handler.JSONError(w, http.StatusTooManyRequests, "Too many requests")
	return true
}

var callbackWorkOSFactory = func(apiKey, clientID string) providers.WorkOSProvider {
	return providers.NewWorkOSClient(apiKey, clientID)
}

func CallbackHandler(w http.ResponseWriter, r *http.Request) {
	client := callbackWorkOSFactory(os.Getenv("WORKOS_API_KEY"), os.Getenv("WORKOS_CLIENT_ID"))

	// Explicitly handle nil Redis client to avoid typed-nil-in-interface issue
	var limiter *ratelimit.RedisRateLimiter
	if redisClient := handler.GetRedisClient(); redisClient != nil {
		limiter = ratelimit.NewRedisRateLimiter(redisClient, "")
	}

	h := &CallbackHandlerStruct{
		WorkOS:     client,
		LinkUser:   linkOrCreateSAMLUser,
		Limiter:    limiter,
		GetQueries: nil,
	}
	h.ServeHTTP(w, r)
}

func linkOrCreateSAMLUser(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
	if q == nil {
		return nil, os.ErrInvalid
	}
	if err := validateSAMLProfileOrganization(ctx, q, profile); err != nil {
		return nil, err
	}
	userRepo := auth.NewAuthUserRepository(q)
	user, err := userRepo.FindByEmail(ctx, profile.Email)
	if errors.Is(err, auth.ErrUserNotFound) {
		user = nil
		err = nil
	}
	if err != nil {
		return nil, err
	}

	fullName := profile.FirstName + " " + profile.LastName
	if user == nil {
		regRepo := auth.NewRegisterRepository(q)
		newUser, err := regRepo.CreateUser(ctx, auth.RegisterUserInput{
			Email:    profile.Email,
			FullName: &fullName,
		})
		if err != nil {
			return nil, err
		}
		user = &auth.AuthUser{
			ID:       newUser.ID,
			Email:    newUser.Email,
			FullName: newUser.FullName,
			Disabled: newUser.Disabled,
		}
	}
	if user.Disabled {
		return nil, auth.ErrUserDisabled
	}
	return user, nil
}

func validateSAMLProfileOrganization(ctx context.Context, q *db.Queries, profile sso.Profile) error {
	domain := samlEmailDomain(profile.Email)
	if domain == "" || strings.TrimSpace(profile.OrganizationID) == "" {
		return errSAMLEmailOrgMismatch
	}

	org, err := q.GetOrganizationByDomain(ctx, &domain)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errSAMLOrgNotFound
		}
		return err
	}
	if org.WorkosOrganizationID == nil || strings.TrimSpace(*org.WorkosOrganizationID) != strings.TrimSpace(profile.OrganizationID) {
		return errSAMLEmailOrgMismatch
	}
	return nil
}

func samlEmailDomain(email string) string {
	normalizedEmail := strings.TrimSpace(email)
	if !handler.IsValidEmail(normalizedEmail) {
		return ""
	}
	_, rawDomain, _ := strings.Cut(normalizedEmail, "@")
	return strings.ToLower(strings.TrimSpace(rawDomain))
}

func ensureSAMLMembership(ctx context.Context, q *db.Queries, userID int, workosOrgID string) error {
	_, err := ensureSAMLMembershipWithOrg(ctx, q, userID, workosOrgID)
	return err
}

func ensureSAMLMembershipWithOrg(ctx context.Context, q *db.Queries, userID int, workosOrgID string) (int32, error) {
	org, err := q.GetOrganizationByWorkosID(ctx, &workosOrgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, errSAMLOrgNotFound
		}
		return 0, err
	}
	if org.ID == 0 {
		return 0, errSAMLOrgNotFound
	}

	_, err = q.GetMembership(ctx, db.GetMembershipParams{
		OrganizationID: org.ID,
		UserID:         int32(userID), // #nosec G115
	})
	if err == nil {
		return org.ID, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := q.CreateMembership(ctx, db.CreateMembershipParams{
			OrganizationID: org.ID,
			UserID:         int32(userID), // #nosec G115
			Role:           db.OrganizationRoleMEMBER,
		}); err != nil {
			return 0, err
		}
		return org.ID, nil
	}

	return 0, err
}
