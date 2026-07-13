package mfa

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	sharedcrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
)

type StatusResponse struct {
	AuthenticatorAppEnabled bool `json:"authenticator_app_enabled"`
}

type SetupResponse struct {
	AuthenticatorAppEnabled bool   `json:"authenticator_app_enabled"`
	Secret                  string `json:"secret"`
	OTPAuthURI              string `json:"otpauth_uri"`
}

type CodeRequest struct {
	Code string `json:"code" validate:"required"`
}

type LoginRequest struct {
	Code     string `json:"code" validate:"required"`
	MFAToken string `json:"mfa_token,omitempty"`
}

type LoginResponse struct {
	Success     bool    `json:"success"`
	RedirectURL string  `json:"redirect_url,omitempty"`
	AccessToken *string `json:"access_token,omitempty"`
	TokenType   *string `json:"token_type,omitempty"`
	ExpiresIn   *int    `json:"expires_in,omitempty"`
}

type requestInfo struct {
	ClientIP *string
}

type authenticatorActionRoute struct {
	operationID, method, path, summary, rateLimitAction string
	rateLimit                                           int
	execute                                             func(context.Context, *adapterauth.AuthenticatedUser, string) (StatusResponse, error)
}

const (
	mfaSetupMaxRequests   = coreidentity.MFASetupMaxAttemptsPerWindow
	mfaVerifyMaxRequests  = coreidentity.MFAVerifyMaxAttemptsPerWindow
	mfaDisableMaxRequests = coreidentity.MFADisableMaxAttemptsPerWindow
	mfaLoginMaxRequests   = coreidentity.MFALoginMaxAttemptsPerWindow
	mfaRateLimitWindow    = coreidentity.MFAAttemptWindow
	mfaChallengeKeyPrefix = "auth:mfa:challenge:"
)

var (
	errMFAChallengeAlreadyUsed = errors.New("mfa challenge already used")
	errMFAChallengeUnavailable = errors.New("mfa challenge store unavailable")
)

var (
	encodeMFAPendingToken = auth.EncodeMFAPendingToken
	generateTOTPSecret    = auth.GenerateTOTPSecret
	buildTOTPURI          = auth.BuildTOTPURI
	encryptSecret         = sharedcrypto.Encrypt
	decryptSecret         = sharedcrypto.Decrypt
	verifyTOTPCode        = auth.VerifyTOTPCode
	encodeSessionToken    = auth.EncodeSessionToken
)

func PendingLoginToken(user auth.SessionUser, redirectURL string) (string, error) {
	if !handler.IsAllowedRedirect(redirectURL) {
		redirectURL = "/"
	}
	return encodeMFAPendingToken(user, redirectURL, strings.TrimSpace(os.Getenv("AUTH_SECRET")))
}

func StartPendingWebLogin(w http.ResponseWriter, r *http.Request, user *auth.AuthUser, sessionUser auth.SessionUser, redirectURL string) bool {
	if user == nil || !user.MFAEnabled {
		return false
	}
	pendingToken, err := PendingLoginToken(sessionUser, redirectURL)
	if err != nil {
		handler.GetLogger().Error("Failed to create pending MFA token", map[string]any{"error": err.Error(), "user_id": user.ID})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to start MFA challenge")
		return true
	}
	isSecure := handler.ShouldUseSecureCookies(r)
	auth.ApplyMFAPendingCookie(w, pendingToken, isSecure)
	http.Redirect(w, r, mfaRedirectURL(redirectURL), http.StatusTemporaryRedirect)
	return true
}

func RegisterHandlers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-mfa-status",
		Method:      http.MethodGet,
		Path:        "/api/v1/auth/mfa",
		Summary:     "Get MFA status",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*struct{ Body StatusResponse }, error) {
		settings, err := loadMFASettings(ctx, input.User)
		if err != nil {
			return nil, err
		}
		return &struct{ Body StatusResponse }{Body: StatusResponse{
			AuthenticatorAppEnabled: settings.MfaEnabled,
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "setup-authenticator-mfa",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/mfa/authenticator/setup",
		Summary:     "Start authenticator app MFA setup",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		requestInfo
	}) (*struct{ Body SetupResponse }, error) {
		if err := checkMFARateLimit(ctx, input.User, input.ClientIP, "setup", mfaSetupMaxRequests); err != nil {
			return nil, err
		}
		body, err := setupAuthenticatorMFA(ctx, input.User)
		if err != nil {
			return nil, err
		}
		return &struct{ Body SetupResponse }{Body: body}, nil
	})

	for _, route := range []authenticatorActionRoute{
		{operationID: "verify-authenticator-mfa", method: http.MethodPost, path: "/api/v1/auth/mfa/authenticator/verify", summary: "Verify and enable authenticator app MFA", rateLimitAction: "verify", rateLimit: mfaVerifyMaxRequests, execute: verifyAuthenticatorMFA},
		{operationID: "disable-authenticator-mfa", method: http.MethodDelete, path: "/api/v1/auth/mfa/authenticator", summary: "Disable authenticator app MFA", rateLimitAction: "disable", rateLimit: mfaDisableMaxRequests, execute: disableAuthenticatorMFA},
	} {
		registerAuthenticatorAction(api, route)
	}
}

func registerAuthenticatorAction(api huma.API, route authenticatorActionRoute) {
	huma.Register(api, huma.Operation{
		OperationID: route.operationID,
		Method:      route.method,
		Path:        route.path,
		Summary:     route.summary,
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		requestInfo
		Body CodeRequest
	}) (*struct{ Body StatusResponse }, error) {
		if err := checkMFARateLimit(ctx, input.User, input.ClientIP, route.rateLimitAction, route.rateLimit); err != nil {
			return nil, err
		}
		body, err := route.execute(ctx, input.User, input.Body.Code)
		if err != nil {
			return nil, err
		}
		return &struct{ Body StatusResponse }{Body: body}, nil
	})
}

func (r *requestInfo) Resolve(ctx huma.Context) []error {
	req := &http.Request{
		Header:     http.Header{},
		RemoteAddr: strings.TrimSpace(ctx.RemoteAddr()),
	}
	if forwardedFor := strings.TrimSpace(ctx.Header("X-Forwarded-For")); forwardedFor != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	if realIP := strings.TrimSpace(ctx.Header("X-Real-IP")); realIP != "" {
		req.Header.Set("X-Real-IP", realIP)
	}
	if ip := handler.GetClientIP(req); ip != nil {
		r.ClientIP = ip
		return nil
	}
	r.ClientIP = handler.ClientIPFromRemoteAddr(ctx.RemoteAddr())
	return nil
}

func checkMFARateLimit(ctx context.Context, user *adapterauth.AuthenticatedUser, clientIP *string, action string, limit int) error {
	if user == nil {
		return huma.Error401Unauthorized("Unauthorized")
	}
	redisClient := handler.GetRedisClient()
	if redisClient == nil {
		if !handler.IsProductionEnv() {
			return nil
		}
		handler.GetLogger().Error("MFA rate limiter unavailable in production", map[string]any{"action": action, "user_id": user.ID})
		return huma.Error503ServiceUnavailable("Service unavailable")
	}
	limiter := ratelimit.NewRedisRateLimiter(redisClient, "auth:mfa")
	for _, key := range mfaRateLimitKeys(user, clientIP, action) {
		result, err := limiter.Check(ctx, key, limit, mfaRateLimitWindow)
		if err != nil {
			handler.GetLogger().Error("MFA rate limit check failed", map[string]any{"error": err.Error(), "action": action, "user_id": user.ID})
			if handler.IsProductionEnv() {
				return huma.Error503ServiceUnavailable("Service unavailable")
			}
			continue
		}
		if !result.Allowed {
			return huma.Error429TooManyRequests("Too many requests")
		}
	}
	return nil
}

func mfaRateLimitKeys(user *adapterauth.AuthenticatedUser, clientIP *string, action string) []string {
	userKey := action + ":user:" + strconv.Itoa(user.ID)
	if clientIP == nil || strings.TrimSpace(*clientIP) == "" {
		return []string{userKey}
	}
	return []string{userKey, action + ":ip:" + strings.TrimSpace(*clientIP)}
}

func setupAuthenticatorMFA(ctx context.Context, user *adapterauth.AuthenticatedUser) (SetupResponse, error) {
	if user == nil {
		return SetupResponse{}, huma.Error401Unauthorized("Unauthorized")
	}
	q, userID, err := resolveUserQueries(ctx, user)
	if err != nil {
		return SetupResponse{}, err
	}
	settings, err := q.GetUserMFASettings(ctx, userID)
	if err != nil {
		return SetupResponse{}, mapUserSettingsErr(err)
	}
	if settings.MfaEnabled {
		return SetupResponse{}, huma.Error409Conflict("Authenticator app MFA is already enabled")
	}

	secret, err := generateTOTPSecret()
	if err != nil {
		return SetupResponse{}, huma.Error500InternalServerError("Failed to create authenticator setup")
	}
	encrypted, err := encryptSecret(secret)
	if err != nil {
		handler.GetLogger().Error("Failed to encrypt MFA TOTP secret", map[string]any{"error": err.Error()})
		return SetupResponse{}, huma.Error500InternalServerError("Failed to create authenticator setup")
	}
	if _, err := q.StoreUserMFASetup(ctx, db.StoreUserMFASetupParams{ID: userID, MfaTotpSecret: &encrypted}); err != nil {
		handler.GetLogger().Error("Failed to store MFA setup", map[string]any{"error": err.Error(), "user_id": userID})
		return SetupResponse{}, huma.Error500InternalServerError("Failed to save authenticator setup")
	}
	auditMFA(ctx, q, user, "SETUP")

	return SetupResponse{
		AuthenticatorAppEnabled: false,
		Secret:                  secret,
		OTPAuthURI:              buildTOTPURI(user.Email, secret),
	}, nil
}

func verifyAuthenticatorMFA(ctx context.Context, user *adapterauth.AuthenticatedUser, code string) (StatusResponse, error) {
	if err := verifyCurrentUserCode(ctx, user, code); err != nil {
		return StatusResponse{}, err
	}
	q, userID, err := resolveUserQueries(ctx, user)
	if err != nil {
		return StatusResponse{}, err
	}
	if _, err := q.EnableUserMFA(ctx, userID); err != nil {
		handler.GetLogger().Error("Failed to enable MFA", map[string]any{"error": err.Error(), "user_id": userID})
		return StatusResponse{}, huma.Error500InternalServerError("Failed to enable authenticator app")
	}
	auditMFA(ctx, q, user, "ENABLE")
	return StatusResponse{AuthenticatorAppEnabled: true}, nil
}

func disableAuthenticatorMFA(ctx context.Context, user *adapterauth.AuthenticatedUser, code string) (StatusResponse, error) {
	if err := verifyCurrentUserCode(ctx, user, code); err != nil {
		return StatusResponse{}, err
	}
	q, userID, err := resolveUserQueries(ctx, user)
	if err != nil {
		return StatusResponse{}, err
	}
	if _, err := q.DisableUserMFA(ctx, userID); err != nil {
		handler.GetLogger().Error("Failed to disable MFA", map[string]any{"error": err.Error(), "user_id": userID})
		return StatusResponse{}, huma.Error500InternalServerError("Failed to disable authenticator app")
	}
	auditMFA(ctx, q, user, "DISABLE")
	return StatusResponse{AuthenticatorAppEnabled: false}, nil
}

func mfaRedirectURL(callbackURL string) string {
	if !handler.IsAllowedRedirect(callbackURL) {
		callbackURL = "/"
	}
	mfaPath := "/login/mfa?callbackUrl=" + url.QueryEscape(callbackURL)
	parsed, err := url.Parse(callbackURL)
	if err == nil && parsed.IsAbs() && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		return parsed.Scheme + "://" + parsed.Host + mfaPath
	}
	return mfaPath
}

func LoginVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	req, ok := readMFALoginRequest(w, r)
	if !ok {
		return
	}
	pendingToken, pending, userID, ok := resolveMFAPendingSession(w, r, req)
	if !ok {
		return
	}
	q, user, ok := verifyMFALoginUser(w, r, userID, pending.User.Email, req.Code)
	if !ok {
		return
	}
	if !consumeMFALoginChallenge(w, r, pendingToken, userID) {
		return
	}

	signedToken, err := encodeSessionToken(pending.User, strings.TrimSpace(os.Getenv("AUTH_SECRET")), auth.DefaultSessionMaxAge)
	if err != nil {
		handler.GetLogger().Error("Failed to generate session after MFA", map[string]any{"error": err.Error(), "user_id": userID})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to create session")
		return
	}

	isSecure := handler.ShouldUseSecureCookies(r)
	auth.ApplySessionCookies(w, signedToken, pending.User, isSecure)
	auth.ClearMFAPendingCookie(w, isSecure)

	redirectURL := allowedMFARedirect(pending.RedirectURL)
	auditUser := &auth.AuthUser{ID: int(user.ID), Email: user.Email, FullName: user.FullName}
	auth.NewAuditService(auth.NewAuditLogRepository(q)).LogLogin(r.Context(), auditUser, true, handler.GetClientIP(r), handler.GetUserAgent(r), nil)

	response := LoginResponse{Success: true, RedirectURL: redirectURL}
	if strings.TrimSpace(req.MFAToken) != "" {
		tokenType := "bearer"
		expires := auth.GetSessionTTL(pending.User)
		response.AccessToken = &signedToken
		response.TokenType = &tokenType
		response.ExpiresIn = &expires
	}
	handler.JSON(w, http.StatusOK, response)
}

func readMFALoginRequest(w http.ResponseWriter, r *http.Request) (LoginRequest, bool) {
	var req LoginRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return LoginRequest{}, false
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return LoginRequest{}, false
	}
	return req, true
}

func resolveMFAPendingSession(w http.ResponseWriter, r *http.Request, req LoginRequest) (string, *auth.MFAPendingSession, int64, bool) {
	token := strings.TrimSpace(req.MFAToken)
	if token == "" {
		cookie, err := r.Cookie(auth.MFAPendingCookieName)
		if err != nil {
			handler.JSONError(w, http.StatusUnauthorized, "MFA session expired")
			return "", nil, 0, false
		}
		token = cookie.Value
	}
	pending, err := auth.VerifyMFAPendingToken(token)
	if err != nil {
		handler.JSONError(w, http.StatusUnauthorized, "MFA session expired")
		return "", nil, 0, false
	}
	userID, err := strconv.ParseInt(pending.User.ID, 10, 32)
	if err != nil || userID <= 0 {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid MFA session")
		return "", nil, 0, false
	}
	return token, pending, userID, true
}

func verifyMFALoginUser(w http.ResponseWriter, r *http.Request, userID int64, email, code string) (*db.Queries, db.User, bool) {
	rateLimitUser := &adapterauth.AuthenticatedUser{ID: int(userID), Email: email}
	if err := checkMFARateLimit(r.Context(), rateLimitUser, handler.GetClientIP(r), "login", mfaLoginMaxRequests); err != nil {
		writeMFAHTTPError(w, err)
		return nil, db.User{}, false
	}
	q, ok := handler.RequireQueriesWithStatus(w, r, nil, http.StatusServiceUnavailable, "Database unavailable")
	if !ok {
		return nil, db.User{}, false
	}
	userID32 := int32(userID) // #nosec G115 -- ParseInt with bitSize 32 and the positive check above bound the value.
	user, err := q.GetUserByID(r.Context(), userID32)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.JSONError(w, http.StatusUnauthorized, "Invalid MFA session")
			return nil, db.User{}, false
		}
		handler.GetLogger().Error("Failed to load MFA login user", map[string]any{"error": err.Error(), "user_id": userID})
		handler.JSONError(w, http.StatusServiceUnavailable, "Database unavailable")
		return nil, db.User{}, false
	}
	if user.Disabled || !user.MfaEnabled || user.MfaTotpSecret == nil {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid MFA session")
		return nil, db.User{}, false
	}
	secret, err := decryptSecret(*user.MfaTotpSecret)
	if err != nil {
		handler.GetLogger().Error("Failed to decrypt MFA secret during login", map[string]any{"error": err.Error(), "user_id": userID})
		handler.JSONError(w, http.StatusInternalServerError, "Unable to verify authenticator code")
		return nil, db.User{}, false
	}
	if !verifyTOTPCode(secret, code, time.Now()) {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid authenticator code")
		return nil, db.User{}, false
	}
	return q, user, true
}

func consumeMFALoginChallenge(w http.ResponseWriter, r *http.Request, token string, userID int64) bool {
	if err := consumeMFAPendingChallenge(r.Context(), token); err != nil {
		if errors.Is(err, errMFAChallengeAlreadyUsed) {
			handler.JSONError(w, http.StatusUnauthorized, "MFA session expired")
			return false
		}
		handler.GetLogger().Error("Failed to consume MFA challenge", map[string]any{"error": err.Error(), "user_id": userID})
		handler.JSONError(w, http.StatusServiceUnavailable, "MFA verification temporarily unavailable")
		return false
	}
	return true
}

func allowedMFARedirect(value string) string {
	if handler.IsAllowedRedirect(value) {
		return value
	}
	return "/"
}

func consumeMFAPendingChallenge(ctx context.Context, pendingToken string) error {
	store := handler.GetRedisClient()
	if store == nil {
		if handler.IsProductionEnv() {
			return errMFAChallengeUnavailable
		}
		return nil
	}

	sum := sha256.Sum256([]byte(pendingToken))
	key := mfaChallengeKeyPrefix + hex.EncodeToString(sum[:])
	created, err := store.SetNX(ctx, key, []byte("1"), time.Duration(auth.MFAPendingMaxAge)*time.Second)
	if err != nil {
		return fmt.Errorf("%w: %w", errMFAChallengeUnavailable, err)
	}
	if !created {
		return errMFAChallengeAlreadyUsed
	}
	return nil
}

func writeMFAHTTPError(w http.ResponseWriter, err error) {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) {
		handler.JSONError(w, statusErr.GetStatus(), statusErr.Error())
		return
	}
	handler.JSONError(w, http.StatusInternalServerError, "Internal error")
}

func loadMFASettings(ctx context.Context, user *adapterauth.AuthenticatedUser) (db.GetUserMFASettingsRow, error) {
	q, userID, err := resolveUserQueries(ctx, user)
	if err != nil {
		return db.GetUserMFASettingsRow{}, err
	}
	settings, err := q.GetUserMFASettings(ctx, userID)
	if err != nil {
		return db.GetUserMFASettingsRow{}, mapUserSettingsErr(err)
	}
	return settings, nil
}

func verifyCurrentUserCode(ctx context.Context, user *adapterauth.AuthenticatedUser, code string) error {
	settings, err := loadMFASettings(ctx, user)
	if err != nil {
		return err
	}
	if settings.MfaTotpSecret == nil {
		return huma.Error400BadRequest("Authenticator app setup has not been started")
	}
	secret, err := decryptSecret(*settings.MfaTotpSecret)
	if err != nil {
		handler.GetLogger().Error("Failed to decrypt MFA TOTP secret", map[string]any{"error": err.Error(), "user_id": settings.ID})
		return huma.Error500InternalServerError("Unable to verify authenticator code")
	}
	if !verifyTOTPCode(secret, code, time.Now()) {
		return huma.Error401Unauthorized("Invalid authenticator code")
	}
	return nil
}

func resolveUserQueries(ctx context.Context, user *adapterauth.AuthenticatedUser) (*db.Queries, int32, error) {
	if user == nil {
		return nil, 0, huma.Error401Unauthorized("Unauthorized")
	}
	const maxInt32Value = int64(1<<31 - 1)
	if user.ID <= 0 || int64(user.ID) > maxInt32Value {
		return nil, 0, huma.Error500InternalServerError("Internal error")
	}
	q, err := handler.ResolveQueries(ctx, nil)
	if err != nil {
		return nil, 0, huma.Error503ServiceUnavailable("Database unavailable")
	}
	return q, int32(user.ID), nil // #nosec G115 - bounded above.
}

func mapUserSettingsErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return huma.Error404NotFound("User not found")
	}
	handler.GetLogger().Error("Failed to load MFA settings", map[string]any{"error": err.Error()})
	return huma.Error503ServiceUnavailable("Database unavailable")
}

func auditMFA(ctx context.Context, q *db.Queries, user *adapterauth.AuthenticatedUser, action string) {
	if q == nil || user == nil {
		return
	}
	uid := strconv.Itoa(user.ID)
	auth.NewAuditService(auth.NewAuditLogRepository(q)).LogEvent(ctx, auth.AuditLogWrite{
		UserID:   &uid,
		Email:    &user.Email,
		Action:   action,
		Resource: "mfa_authenticator",
		Success:  true,
	})
}
