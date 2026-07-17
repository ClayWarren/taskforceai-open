// Package auth provides authentication services.
package auth

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	"github.com/golang-jwt/jwt/v5"
)

const (
	SessionCookieName       = "session_token"
	SecureSessionCookieName = "__Secure-session_token"
	MFAPendingCookieName    = "mfa_pending_token"
	DefaultSessionMaxAge    = coreidentity.ConsumerSessionMaxAgeSeconds
	EnterpriseSessionMaxAge = coreidentity.EnterpriseSessionMaxAgeSeconds
	MFAPendingMaxAge        = coreidentity.MFAPendingSessionMaxAgeSeconds
)

type SessionUser struct {
	ID              string     `json:"id"`
	Email           string     `json:"email,omitempty"`
	FullName        string     `json:"full_name,omitempty"`
	Avatar          *string    `json:"avatar,omitempty"`
	OrgID           *string    `json:"org_id,omitempty"`
	InternalOrgID   *int       `json:"internal_org_id,omitempty"`
	ImpersonatorID  *string    `json:"impersonator_id,omitempty"`
	AuthenticatedAt *time.Time `json:"authenticated_at,omitempty"`
}

type MFAPendingSession struct {
	User        SessionUser
	RedirectURL string
}

var (
	signKey       *rsa.PrivateKey
	verifyKeys    []*rsa.PublicKey // Support multiple public keys for key rotation
	verifyKeysSet bool
	verifyKeysErr error
	hs256AuthKey  []byte
	sessionParser *jwt.Parser
	keysOnce      sync.Once
	initErr       error
)

// ErrInvalidToken is returned when token verification fails.
var ErrInvalidToken = errors.New("invalid token")

// ResetJWTKeysForTest clears cached JWT key initialization (tests only).
var ResetJWTKeysForTest = func() {
	keysOnce = sync.Once{}
	initErr = nil
	signKey = nil
	verifyKeys = nil
	verifyKeysSet = false
	verifyKeysErr = nil
	hs256AuthKey = nil
	sessionParser = nil
}

// InitKeys initializes signing and verification keys from environment variables.
// This function is safe to call multiple times; it will only initialize once.
func InitKeys() error {
	keysOnce.Do(func() {
		// Parse signing key (AUTH_PRIVATE_KEY)
		privateKeyPEM := strings.TrimSpace(os.Getenv("AUTH_PRIVATE_KEY"))
		if privateKeyPEM != "" {
			// Handle escaped newlines from env vars
			privateKeyPEM = strings.ReplaceAll(privateKeyPEM, "\\n", "\n")
			key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(privateKeyPEM))
			if err != nil {
				slog.Error("Failed to parse AUTH_PRIVATE_KEY", "error", err)
				initErr = err
				return
			}
			signKey = key
		}

		// Parse verification keys (AUTH_PUBLIC_KEYS - comma-separated, fallback to AUTH_PUBLIC_KEY)
		publicKeysPEM := strings.TrimSpace(os.Getenv("AUTH_PUBLIC_KEYS"))
		if publicKeysPEM == "" {
			publicKeysPEM = strings.TrimSpace(os.Getenv("AUTH_PUBLIC_KEY"))
		}

		if publicKeysPEM != "" {
			verifyKeysSet = true
			// Split by comma for multiple keys
			keyParts := strings.SplitSeq(publicKeysPEM, ",")
			for keyPEM := range keyParts {
				keyPEM = strings.TrimSpace(keyPEM)
				if keyPEM == "" {
					continue
				}
				// Handle escaped newlines from env vars
				keyPEM = strings.ReplaceAll(keyPEM, "\\n", "\n")
				pubKey, err := jwt.ParseRSAPublicKeyFromPEM([]byte(keyPEM))
				if err != nil {
					if verifyKeysErr == nil {
						verifyKeysErr = err
					}
					slog.Warn("Failed to parse one of AUTH_PUBLIC_KEYS", "error", err)
					continue
				}
				verifyKeys = append(verifyKeys, pubKey)
			}
		}

		// A signer must always be represented in the explicit verifier set. Otherwise
		// this service can mint sessions that every service, including itself, rejects.
		if signKey != nil {
			switch {
			case !verifyKeysSet:
				verifyKeys = append(verifyKeys, &signKey.PublicKey)
			case len(verifyKeys) == 0:
				initErr = fmt.Errorf("auth: no valid AUTH_PUBLIC_KEYS configured for AUTH_PRIVATE_KEY")
				return
			case !containsRSAPublicKey(verifyKeys, &signKey.PublicKey):
				initErr = fmt.Errorf("auth: AUTH_PRIVATE_KEY is not present in AUTH_PUBLIC_KEYS")
				return
			}
		}

		if authSecret := strings.TrimSpace(os.Getenv("AUTH_SECRET")); authSecret != "" {
			hs256AuthKey = []byte(authSecret)
		}

		sessionParser = jwt.NewParser()

		slog.Info("JWT keys initialized", "hasSigningKey", signKey != nil, "verifyKeyCount", len(verifyKeys))
	})
	return initErr
}

func containsRSAPublicKey(keys []*rsa.PublicKey, target *rsa.PublicKey) bool {
	if target == nil || target.N == nil {
		return false
	}
	for _, key := range keys {
		if key != nil && key.N != nil && key.E == target.E && key.N.Cmp(target.N) == 0 {
			return true
		}
	}
	return false
}

// VerifyToken verifies a JWT token using any of the configured public keys.
// This supports key rotation by trying all available verification keys.
func VerifyToken(tokenString string) (*jwt.Token, error) {
	// Initialize keys if not done yet
	if err := InitKeys(); err != nil {
		return nil, fmt.Errorf("auth: failed to initialize JWT keys: %w", err)
	}

	// Try each verification key
	for _, verifyKey := range verifyKeys {
		token, err := sessionParser.Parse(tokenString, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok || !strings.HasPrefix(token.Method.Alg(), "RS") {
				return nil, ErrInvalidToken
			}
			return verifyKey, nil
		})
		if err == nil && token.Valid && validateSessionTokenClaims(token) == nil {
			return token, nil
		}
	}

	// When RSA verification keys are configured, do not allow algorithm fallback.
	if len(verifyKeys) > 0 {
		return nil, ErrInvalidToken
	}
	if verifyKeysSet {
		if verifyKeysErr != nil {
			return nil, fmt.Errorf("auth: invalid JWT public key configuration: %w", verifyKeysErr)
		}
		return nil, ErrInvalidToken
	}

	// Fall back to HS256 with AUTH_SECRET only when RSA keys are not configured.
	if len(hs256AuthKey) > 0 {
		token, err := sessionParser.Parse(tokenString, func(token *jwt.Token) (any, error) {
			if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, ErrInvalidToken
			}
			return hs256AuthKey, nil
		})
		if err == nil && token.Valid && validateSessionTokenClaims(token) == nil {
			return token, nil
		}
	}

	return nil, ErrInvalidToken
}

type sessionClaimValidationConfig struct {
	expectedAudience string
	expectedIssuer   string
	requireAudIss    bool
}

func validateSessionTokenClaims(token *jwt.Token) error {
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return ErrInvalidToken
	}
	expiresAt, err := claims.GetExpirationTime()
	if err != nil || expiresAt == nil {
		return ErrInvalidToken
	}

	cfg := sessionClaimValidationConfigFromEnv()
	if err := validateSessionIssuer(claims, cfg); err != nil {
		return err
	}
	if err := validateSessionAudience(claims, cfg); err != nil {
		return err
	}
	return nil
}

func sessionClaimValidationConfigFromEnv() sessionClaimValidationConfig {
	expectedAudience := firstNonEmptyEnv("AUTH_EXPECTED_AUDIENCE", "AUTH_EXPECTED_AUD")
	expectedIssuer := firstNonEmptyEnv("AUTH_EXPECTED_ISSUER", "AUTH_EXPECTED_ISS", "AUTH_URL")
	requireAudIss := parseBoolEnv("AUTH_REQUIRE_AUD_ISS") || parseBoolEnv("AUTH_STRICT_AUD_ISS")
	return sessionClaimValidationConfig{
		expectedAudience: expectedAudience,
		expectedIssuer:   expectedIssuer,
		requireAudIss:    requireAudIss,
	}
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func parseBoolEnv(key string) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	return err == nil && value
}

func validateSessionIssuer(claims jwt.MapClaims, cfg sessionClaimValidationConfig) error {
	issuer, err := claims.GetIssuer()
	if err != nil {
		return ErrInvalidToken
	}
	if issuer == "" {
		if cfg.requireAudIss && cfg.expectedIssuer != "" {
			return ErrInvalidToken
		}
		return nil
	}
	if cfg.expectedIssuer != "" && issuer != cfg.expectedIssuer {
		return ErrInvalidToken
	}
	return nil
}

func validateSessionAudience(claims jwt.MapClaims, cfg sessionClaimValidationConfig) error {
	audience, err := claims.GetAudience()
	if err != nil {
		return ErrInvalidToken
	}
	if len(audience) == 0 {
		if cfg.requireAudIss && cfg.expectedAudience != "" {
			return ErrInvalidToken
		}
		return nil
	}
	if cfg.expectedAudience == "" {
		return nil
	}
	for _, value := range audience {
		if value == cfg.expectedAudience {
			return nil
		}
	}
	return ErrInvalidToken
}

func applySessionIssuerAudienceClaims(claims jwt.MapClaims) {
	cfg := sessionClaimValidationConfigFromEnv()
	if cfg.expectedIssuer != "" {
		claims["iss"] = cfg.expectedIssuer
	}
	if cfg.expectedAudience != "" {
		claims["aud"] = cfg.expectedAudience
	}
}

func BuildSessionPayload(user *AuthUser) SessionUser {
	u := SessionUser{
		ID:    strconv.Itoa(user.ID),
		Email: user.Email,
	}
	if user.FullName != nil {
		u.FullName = *user.FullName
	}
	return u
}

// GetSessionTTL returns the appropriate TTL based on the user context (Enterprise vs Consumer)
func GetSessionTTL(user SessionUser) int {
	return coreidentity.ResolveSessionMaxAgeSeconds(coreidentity.SessionPolicyContext{
		HasOrganization: (user.OrgID != nil && *user.OrgID != "") || user.InternalOrgID != nil,
		IsImpersonated:  user.ImpersonatorID != nil,
	})
}

// EncodeSessionToken creates a standard JWS token.
// Uses RS256 if AUTH_PRIVATE_KEY is present, otherwise falls back to HS256 using AUTH_SECRET.
func EncodeSessionToken(user SessionUser, secret string, maxAgeSeconds int) (string, error) {
	// If maxAgeSeconds is 0 or Default, we dynamically decide
	if maxAgeSeconds <= 0 || maxAgeSeconds == DefaultSessionMaxAge {
		maxAgeSeconds = GetSessionTTL(user)
	}

	now := time.Now()
	authenticatedAt := now
	if user.AuthenticatedAt != nil && !user.AuthenticatedAt.IsZero() {
		if user.AuthenticatedAt.After(now.Add(5 * time.Minute)) {
			return "", fmt.Errorf("auth: authentication time cannot be in the future")
		}
		authenticatedAt = *user.AuthenticatedAt
	}
	claims := jwt.MapClaims{
		"sub":       user.ID,
		"id":        user.ID,
		"user_id":   user.ID,
		"name":      user.FullName,
		"email":     user.Email,
		"iat":       now.Unix(),
		"auth_time": authenticatedAt.Unix(),
		"exp":       now.Add(time.Duration(maxAgeSeconds) * time.Second).Unix(),
	}

	if user.OrgID != nil {
		claims["workos_org_id"] = *user.OrgID
	}
	if user.InternalOrgID != nil {
		claims["org_id"] = *user.InternalOrgID
	}
	if user.Avatar != nil {
		claims["picture"] = *user.Avatar
	}
	if user.ImpersonatorID != nil {
		claims["act_as"] = *user.ImpersonatorID
	}
	applySessionIssuerAudienceClaims(claims)

	// Initialize keys if not done yet
	if err := InitKeys(); err != nil {
		return "", fmt.Errorf("auth: failed to initialize JWT keys: %w", err)
	}

	// Use RS256 if we have a private key
	if signKey != nil {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		return token.SignedString(signKey)
	}

	// Fallback to HS256
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", fmt.Errorf("auth: AUTH_SECRET is required when no signing key is configured")
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func EncodeMFAPendingToken(user SessionUser, redirectURL string, secret string) (string, error) {
	if err := InitKeys(); err != nil {
		return "", fmt.Errorf("auth: failed to initialize JWT keys: %w", err)
	}
	if secret == "" && signKey == nil {
		return "", fmt.Errorf("auth: AUTH_SECRET is required when no signing key is configured")
	}
	now := time.Now()
	authenticatedAt := now
	if user.AuthenticatedAt != nil && !user.AuthenticatedAt.IsZero() {
		if user.AuthenticatedAt.After(now.Add(5 * time.Minute)) {
			return "", fmt.Errorf("auth: authentication time cannot be in the future")
		}
		authenticatedAt = *user.AuthenticatedAt
	}
	claims := jwt.MapClaims{
		"sub":          user.ID,
		"id":           user.ID,
		"user_id":      user.ID,
		"name":         user.FullName,
		"email":        user.Email,
		"mfa_pending":  true,
		"redirect_url": redirectURL,
		"iat":          now.Unix(),
		"auth_time":    authenticatedAt.Unix(),
		"exp":          now.Add(time.Duration(MFAPendingMaxAge) * time.Second).Unix(),
	}
	if user.OrgID != nil {
		claims["workos_org_id"] = *user.OrgID
	}
	if user.InternalOrgID != nil {
		claims["org_id"] = *user.InternalOrgID
	}
	applySessionIssuerAudienceClaims(claims)

	if signKey != nil {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		return token.SignedString(signKey)
	}
	secret = strings.TrimSpace(secret)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func VerifyMFAPendingToken(tokenString string) (*MFAPendingSession, error) {
	token, err := VerifyToken(tokenString)
	if err != nil {
		return nil, err
	}
	return mfaPendingSessionFromClaims(token.Claims)
}

func mfaPendingSessionFromClaims(claims jwt.Claims) (*MFAPendingSession, error) {
	mapped, ok := claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	pending, ok := mapped["mfa_pending"].(bool)
	if !ok || !pending {
		return nil, ErrInvalidToken
	}
	userID, _ := mapped["id"].(string)
	if strings.TrimSpace(userID) == "" {
		userID, _ = mapped["sub"].(string)
	}
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidToken
	}
	user := SessionUser{
		ID:       userID,
		Email:    stringClaim(mapped, "email"),
		FullName: stringClaim(mapped, "name"),
	}
	if orgID := stringClaim(mapped, "workos_org_id"); orgID != "" {
		user.OrgID = &orgID
	}
	if orgID, ok := intClaim(mapped, "org_id"); ok {
		user.InternalOrgID = &orgID
	}
	return &MFAPendingSession{
		User:        user,
		RedirectURL: stringClaim(mapped, "redirect_url"),
	}, nil
}

func stringClaim(claims jwt.MapClaims, key string) string {
	value, _ := claims[key].(string)
	return value
}

func intClaim(claims jwt.MapClaims, key string) (int, bool) {
	switch value := claims[key].(type) {
	case float64:
		return int(value), true
	case int:
		return value, true
	default:
		return 0, false
	}
}

// IsTokenNearExpiry returns true if the token is past the given fraction of its lifetime.
// For example, thresholdFraction=0.5 means the token is past halfway to expiration.
func IsTokenNearExpiry(token *jwt.Token, thresholdFraction float64) bool {
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}

	iatVal, iatOk := claims["iat"]
	expVal, expOk := claims["exp"]
	if !iatOk || !expOk {
		return false
	}

	var iat, exp float64
	switch v := iatVal.(type) {
	case float64:
		iat = v
	case int64:
		iat = float64(v)
	default:
		return false
	}
	switch v := expVal.(type) {
	case float64:
		exp = v
	case int64:
		exp = float64(v)
	default:
		return false
	}

	lifetime := exp - iat
	if lifetime <= 0 {
		return false
	}

	elapsed := float64(time.Now().Unix()) - iat
	return elapsed/lifetime >= thresholdFraction
}

// GetCookieDomain returns the cookie domain from the environment variable, trimmed of whitespace.
func GetCookieDomain() string {
	return strings.TrimSpace(os.Getenv("COOKIE_DOMAIN"))
}

func GetSessionCookieOptions(maxAge int, isSecure bool) *http.Cookie {
	opts := sessionCookieOptions(maxAge, isSecure)
	return &opts
}

func sessionCookieOptions(maxAge int, isSecure bool) http.Cookie {
	domain := GetCookieDomain()
	// Always use SameSite=Lax for security (defense in depth against CSRF)
	sameSite := http.SameSiteLaxMode
	if !isSecure {
		// For local development, especially when proxied, it's often safer to NOT set Domain
		// so it defaults to the exact host.
		domain = ""
	}

	return http.Cookie{ //nolint:gosec // Secure is disabled only for local/non-TLS development cookies.
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: sameSite,
		Domain:   domain,
	}
}

// ApplySessionCookies sets cookies on the ResponseWriter.
// Logic mirrors TS: sets session cookie and secure cookie (if prod).
func ApplySessionCookies(w http.ResponseWriter, token string, user SessionUser, isSecure bool, customMaxAge ...int) {
	maxAge := GetSessionTTL(user)
	if len(customMaxAge) > 0 && customMaxAge[0] > 0 {
		maxAge = customMaxAge[0]
	}
	opts := sessionCookieOptions(maxAge, isSecure)

	// Primary
	c := opts //nolint:gosec // opts carries HttpOnly, SameSite, and environment-aware Secure.
	c.Name = SessionCookieName
	c.Value = token
	if isSecure {
		c.Secure = true
	}
	http.SetCookie(w, &c)

	// Secure
	if isSecure {
		sc := opts //nolint:gosec // opts carries HttpOnly, SameSite, and secure-cookie settings.
		sc.Name = SecureSessionCookieName
		sc.Value = token
		sc.Secure = true
		http.SetCookie(w, &sc)
	}
}

func ApplyMFAPendingCookie(w http.ResponseWriter, token string, isSecure bool) {
	c := sessionCookieOptions(MFAPendingMaxAge, isSecure) //nolint:gosec // opts carries HttpOnly, SameSite, and environment-aware Secure.
	c.Name = MFAPendingCookieName
	c.Value = token
	http.SetCookie(w, &c)
}

func ClearMFAPendingCookie(w http.ResponseWriter, isSecure bool) {
	c := sessionCookieOptions(-1, isSecure) //nolint:gosec // opts carries HttpOnly, SameSite, and environment-aware Secure.
	c.Name = MFAPendingCookieName
	c.Value = ""
	c.MaxAge = -1
	http.SetCookie(w, &c)
}
