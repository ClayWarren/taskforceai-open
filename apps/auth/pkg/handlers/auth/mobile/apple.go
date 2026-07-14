package mobile

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
)

type AppleAuthRequest struct {
	IdentityToken     string  `json:"identityToken" validate:"required"`
	AuthorizationCode string  `json:"authorizationCode,omitempty"`
	Nonce             string  `json:"nonce" validate:"required"`
	Email             *string `json:"email,omitempty"`
	FullName          *string `json:"fullName,omitempty"`
}

type LinkAppleUserFunc func(ctx context.Context, q *db.Queries, claims *providers.AppleClaims, fallbackEmail, fullName string) (*auth.AuthUser, error)
type AppleNonceStore interface {
	SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error)
}

type AppleHandlerStruct struct {
	Apple      providers.AppleProvider
	LinkUser   LinkAppleUserFunc
	AuditLog   *auth.AuditService
	GetQueries func(ctx context.Context) (*db.Queries, error)
	NonceStore AppleNonceStore
}

var (
	newAppleClient       = func(clientID string) providers.AppleProvider { return providers.NewAppleClient(clientID) }
	defaultAppleQueries  = appdatabase.GetQueries
	defaultLinkAppleUser = linkOrCreateAppleUser
)

const (
	appleNonceTTL       = 10 * time.Minute
	appleExpoGoAudience = "host.exp.Exponent"
)

var (
	errAppleNonceMismatch    = errors.New("apple nonce mismatch")
	errAppleNonceReplay      = errors.New("apple nonce already used")
	errAppleNonceUnavailable = errors.New("apple nonce store unavailable")
)

func (h *AppleHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	auditLog := h.AuditLog

	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req AppleAuthRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return
	}
	req.IdentityToken = strings.TrimSpace(req.IdentityToken)
	req.AuthorizationCode = strings.TrimSpace(req.AuthorizationCode)
	req.Nonce = strings.TrimSpace(req.Nonce)
	if req.IdentityToken == "" || req.Nonce == "" {
		handler.JSONError(w, http.StatusBadRequest, "identityToken and nonce are required")
		return
	}

	audiences := resolveAppleAudiences()
	if len(audiences) == 0 {
		handler.GetLogger().Error("Apple auth configuration missing", map[string]any{
			"hasAppleClientID": strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID")) != "",
			"hasAppleBundleID": strings.TrimSpace(os.Getenv("APPLE_BUNDLE_ID")) != "",
			"hasAllowedAuds":   strings.TrimSpace(os.Getenv("APPLE_ALLOWED_AUDIENCES")) != "",
		})
		handler.JSONError(w, http.StatusInternalServerError, "Apple auth not configured")
		return
	}

	claims, err := h.verifyAppleIdentityToken(req.IdentityToken, audiences)
	if err != nil {
		handler.GetLogger().Warn("Apple identity token verification failed", map[string]any{
			"error":            err.Error(),
			"acceptedAudience": strings.Join(audiences, ","),
			"tokenAudience":    extractTokenAudience(req.IdentityToken),
		})
		logLoginFailure(r, nil, "Invalid token", auditLog)
		handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
		return
	}
	if err := h.validateAppleNonce(r.Context(), claims, req.Nonce); err != nil {
		if errors.Is(err, errAppleNonceUnavailable) {
			handler.GetLogger().Error("Apple nonce validation unavailable", map[string]any{"error": err.Error()})
			logLoginFailure(r, nil, "Apple nonce validation unavailable", auditLog)
			handler.JSONError(w, http.StatusServiceUnavailable, "Apple auth temporarily unavailable")
			return
		}
		logLoginFailure(r, nil, "Invalid Apple nonce", auditLog)
		handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
		return
	}

	getQueries := h.GetQueries
	if getQueries == nil {
		getQueries = defaultAppleQueries
	}
	q, auditLog, ok := requireMobileAuthQueries(w, r, getQueries, auditLog)
	if !ok {
		return
	}

	fallbackEmail := normalizeOptional(req.Email)
	fullName := normalizeOptional(req.FullName)
	linkUser := h.LinkUser
	if linkUser == nil {
		linkUser = defaultLinkAppleUser
	}

	user, err := linkUser(r.Context(), q, claims, fallbackEmail, fullName)
	if err != nil {
		handleOAuthLinkError(w, r, err, auditLog, "Apple", "Email missing from Apple profile")
		return
	}

	writeMobileSessionResponse(w, r, user, auditLog, "Apple")
}

func Handler(w http.ResponseWriter, r *http.Request) {
	h := &AppleHandlerStruct{
		Apple:    nil,
		LinkUser: linkOrCreateAppleUser,
		AuditLog: nil,
	}
	h.ServeHTTP(w, r)
}

func resolveAppleAudiences() []string {
	seen := map[string]struct{}{}
	audiences := make([]string, 0, 4)

	addAudience := func(raw string) {
		value := strings.TrimSpace(raw)
		if value == "" {
			return
		}
		if handler.IsProductionEnv() && strings.EqualFold(value, appleExpoGoAudience) {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		audiences = append(audiences, value)
	}

	addAudience(os.Getenv("APPLE_CLIENT_ID"))
	addAudience(os.Getenv("APPLE_BUNDLE_ID"))

	for candidate := range strings.SplitSeq(strings.TrimSpace(os.Getenv("APPLE_ALLOWED_AUDIENCES")), ",") {
		addAudience(candidate)
	}

	return audiences
}

func (h *AppleHandlerStruct) verifyAppleIdentityToken(identityToken string, audiences []string) (*providers.AppleClaims, error) {
	if h.Apple != nil {
		return h.Apple.VerifyIdentityToken(identityToken)
	}

	var lastErr error
	for _, audience := range audiences {
		claims, err := newAppleClient(audience).VerifyIdentityToken(identityToken)
		if err == nil {
			return claims, nil
		}
		lastErr = err
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("no configured Apple audiences")
}

func (h *AppleHandlerStruct) validateAppleNonce(ctx context.Context, claims *providers.AppleClaims, nonce string) error {
	nonce = strings.TrimSpace(nonce)
	if claims == nil || nonce == "" || strings.TrimSpace(claims.Nonce) != nonce {
		return errAppleNonceMismatch
	}

	store := h.NonceStore
	if store == nil {
		store = handler.GetRedisClient()
	}
	if store == nil {
		if handler.IsProductionEnv() {
			return errAppleNonceUnavailable
		}
		return nil
	}

	key := appleNonceKey(nonce)
	created, err := store.SetNX(ctx, key, []byte("1"), appleNonceTTL)
	if err != nil {
		return errAppleNonceUnavailable
	}
	if !created {
		return errAppleNonceReplay
	}
	return nil
}

func appleNonceKey(nonce string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(nonce)))
	return "auth:apple:nonce:" + hex.EncodeToString(sum[:])
}

func extractTokenAudience(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}

	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}

	rawAudience, ok := claims["aud"]
	if !ok {
		return ""
	}
	switch value := rawAudience.(type) {
	case string:
		return value
	case []any:
		stringAudiences := make([]string, 0, len(value))
		for _, entry := range value {
			entryValue, ok := entry.(string)
			if !ok {
				continue
			}
			entryValue = strings.TrimSpace(entryValue)
			if entryValue != "" {
				stringAudiences = append(stringAudiences, entryValue)
			}
		}
		return strings.Join(stringAudiences, ",")
	default:
		return ""
	}
}

func normalizeOptional(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func linkOrCreateAppleUser(
	ctx context.Context,
	q *db.Queries,
	claims *providers.AppleClaims,
	fallbackEmail string,
	fullName string,
) (*auth.AuthUser, error) {
	if claims == nil {
		return nil, errors.New("claims are required")
	}

	email := ""
	if appleEmailVerified(claims.EmailVerified) {
		email = strings.TrimSpace(claims.Email)
	}
	if email == "" {
		email = syntheticAppleEmail(claims.Subject)
	}
	// We do NOT use fallbackEmail here because it is unverified client input.
	// Apple only returns email on the first authorization, so repeat App Review
	// attempts may need a stable provider-scoped placeholder instead.

	return linkOrCreateOAuthUser(ctx, q, oauthLinkInput{
		Provider:          "apple",
		ProviderAccountID: claims.Subject,
		Email:             email,
		FullName:          fullName,
	})
}

func appleEmailVerified(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func syntheticAppleEmail(subject string) string {
	normalizedSubject := strings.TrimSpace(subject)
	if normalizedSubject == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalizedSubject))
	return "apple-" + hex.EncodeToString(sum[:16]) + "@users.taskforceai.invalid"
}

func logLoginSuccess(r *http.Request, user *auth.AuthUser, auditLog *auth.AuditService) {
	if auditLog == nil {
		return
	}
	auditLog.LogLogin(r.Context(), user, true, handler.GetClientIP(r), handler.GetUserAgent(r), nil)
}

func logLoginFailure(r *http.Request, user *auth.AuthUser, reason string, auditLog *auth.AuditService) {
	if auditLog == nil {
		return
	}
	msg := reason
	auditLog.LogLogin(r.Context(), user, false, handler.GetClientIP(r), handler.GetUserAgent(r), &msg)
}
