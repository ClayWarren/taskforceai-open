package auth

import (
	"crypto/rsa"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AuthenticatedUser represents the authenticated user in the request context.
type AuthenticatedUser struct {
	ID               int
	Email            string
	FullName         *string
	Plan             *string
	IsAdmin          bool
	QuickModeEnabled bool
	OrgID            *int
	WorkosOrgID      *string
	ImpersonatorID   *string
	ExpiresAt        *time.Time
}

var (
	verifyKeys           []*rsa.PublicKey
	verifyKeysConfigured bool
	verifyKeysErr        error
	keysOnce             sync.Once
)

type tokenClaimValidationConfig struct {
	expectedAudiences map[string]struct{}
	expectedIssuers   map[string]struct{}
	requireClaims     bool
}

// ValidateToken validates a JWT token and returns the claims.
// Supports RS256 (Public Key) and HS256 (Shared Secret).
func ValidateToken(tokenString string) (jwt.MapClaims, error) {
	keysOnce.Do(initializeVerificationKeys)

	if verifyKeysConfigured && len(verifyKeys) == 0 && verifyKeysErr != nil {
		return nil, fmt.Errorf("invalid RSA public key configuration: %w", verifyKeysErr)
	}
	if verifyKeysConfigured && len(verifyKeys) == 0 {
		return nil, fmt.Errorf("invalid RSA public key configuration")
	}

	if claims, ok, err := validateRSAToken(tokenString); err != nil || ok {
		return claims, err
	}

	// When RSA verification keys are configured, do not allow algorithm fallback.
	if len(verifyKeys) > 0 {
		return nil, fmt.Errorf("invalid token")
	}

	// Fallback to HS256 with AUTH_SECRET
	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if secret == "" {
		return nil, fmt.Errorf("invalid token")
	}
	if claims, ok, err := validateHMACToken(tokenString, secret); err != nil || ok {
		return claims, err
	}
	return nil, fmt.Errorf("invalid token")
}

func initializeVerificationKeys() {
	publicKeyPEM := strings.TrimSpace(os.Getenv("AUTH_PUBLIC_KEY"))
	if publicKeyPEM == "" {
		publicKeyPEM = strings.TrimSpace(os.Getenv("AUTH_PUBLIC_KEYS"))
	}
	if publicKeyPEM == "" {
		return
	}

	verifyKeysConfigured = true
	for part := range strings.SplitSeq(publicKeyPEM, ",") {
		keyPEM := strings.TrimSpace(part)
		if keyPEM == "" {
			continue
		}
		pubKey, err := jwt.ParseRSAPublicKeyFromPEM([]byte(strings.ReplaceAll(keyPEM, "\\n", "\n")))
		if err == nil {
			verifyKeys = append(verifyKeys, pubKey)
			continue
		}
		slog.Error("Failed to parse AUTH_PUBLIC_KEY", "error", err)
		if verifyKeysErr == nil {
			verifyKeysErr = err
		}
	}
}

func validateRSAToken(tokenString string) (jwt.MapClaims, bool, error) {
	for _, verificationKey := range verifyKeys {
		token, err := jwt.Parse(tokenString, rsaKeyFunc(verificationKey))
		if err != nil || !token.Valid {
			continue
		}
		if !strings.HasPrefix(token.Method.Alg(), "RS") {
			return nil, false, fmt.Errorf("invalid RSA signing method: %v", token.Method.Alg())
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			continue
		}
		if err := validateExpectedTokenClaims(claims); err != nil {
			return nil, false, err
		}
		return claims, true, nil
	}
	return nil, false, nil
}

func rsaKeyFunc(key *rsa.PublicKey) jwt.Keyfunc {
	return func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return key, nil
	}
}

func validateHMACToken(tokenString, secret string) (jwt.MapClaims, bool, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		// Issue #3: JWT algorithm confusion check
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err == nil && token.Valid {
		return validHMACClaims(token)
	}
	return nil, false, nil
}

func validHMACClaims(token *jwt.Token) (jwt.MapClaims, bool, error) {
	if token == nil {
		return nil, false, nil
	}
	// Ensure it's exactly HS256 as specified in the audit
	if token.Method.Alg() != "HS256" {
		return nil, false, fmt.Errorf("unexpected HMAC algorithm: %v", token.Method.Alg())
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, false, nil
	}
	if err := validateExpectedTokenClaims(claims); err != nil {
		return nil, false, err
	}
	return claims, true, nil
}

func validateExpectedTokenClaims(claims jwt.MapClaims) error {
	if err := validateRequiredExpirationClaim(claims); err != nil {
		return err
	}
	cfg := tokenClaimValidationConfigFromEnv()
	if err := validateExpectedIssuerClaim(claims, cfg); err != nil {
		return err
	}
	return validateExpectedAudienceClaim(claims, cfg)
}

func validateRequiredExpirationClaim(claims jwt.MapClaims) error {
	exp, err := claims.GetExpirationTime()
	if err != nil {
		return fmt.Errorf("invalid exp claim")
	}
	if exp == nil {
		return fmt.Errorf("token missing exp claim")
	}
	if time.Now().After(exp.Time) {
		return fmt.Errorf("token expired")
	}
	return nil
}

func validateExpectedIssuerClaim(claims jwt.MapClaims, cfg tokenClaimValidationConfig) error {
	if len(cfg.expectedIssuers) == 0 {
		return nil
	}

	iss, hasIssuer, err := issuerFromClaims(claims)
	if err != nil {
		return err
	}
	if !hasIssuer {
		if cfg.requireClaims {
			return fmt.Errorf("token missing issuer claim")
		}
		return nil
	}
	if _, ok := cfg.expectedIssuers[normalizeIssuer(iss)]; !ok {
		return fmt.Errorf("token issuer mismatch")
	}

	return nil
}

func validateExpectedAudienceClaim(claims jwt.MapClaims, cfg tokenClaimValidationConfig) error {
	if len(cfg.expectedAudiences) == 0 {
		return nil
	}

	audiences, hasAudience, err := audiencesFromClaims(claims)
	if err != nil {
		return err
	}
	if !hasAudience {
		if cfg.requireClaims {
			return fmt.Errorf("token missing audience claim")
		}
		return nil
	}
	for _, aud := range audiences {
		if _, ok := cfg.expectedAudiences[normalizeAudience(aud)]; ok {
			return nil
		}
	}

	return fmt.Errorf("token audience mismatch")
}

func tokenClaimValidationConfigFromEnv() tokenClaimValidationConfig {
	return tokenClaimValidationConfig{
		expectedAudiences: csvEnvToSet("AUTH_EXPECTED_AUDIENCE", "AUTH_EXPECTED_AUD"),
		expectedIssuers:   csvEnvToSet("AUTH_EXPECTED_ISSUER", "AUTH_EXPECTED_ISS", "AUTH_URL"),
		// Compatibility-safe by default: enforce exact values when claims are present,
		// but allow legacy tokens that omit aud/iss unless strict mode is explicitly enabled.
		requireClaims: envTrue("AUTH_REQUIRE_AUD_ISS", "AUTH_STRICT_AUD_ISS"),
	}
}

func csvEnvToSet(keys ...string) map[string]struct{} {
	values := make(map[string]struct{})
	for _, key := range keys {
		raw := strings.TrimSpace(os.Getenv(key))
		if raw == "" {
			continue
		}
		for part := range strings.SplitSeq(raw, ",") {
			value := strings.TrimSpace(part)
			if value == "" {
				continue
			}
			switch {
			case strings.Contains(strings.ToLower(key), "iss"), key == "AUTH_URL":
				values[normalizeIssuer(value)] = struct{}{}
			default:
				values[normalizeAudience(value)] = struct{}{}
			}
		}
	}
	return values
}

func envTrue(keys ...string) bool {
	for _, key := range keys {
		switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
		case "1", "true", "t", "yes", "y", "on":
			return true
		}
	}
	return false
}

func issuerFromClaims(claims jwt.MapClaims) (string, bool, error) {
	raw, ok := claims["iss"]
	if !ok || raw == nil {
		return "", false, nil
	}
	issuer, ok := raw.(string)
	if !ok {
		return "", false, fmt.Errorf("invalid token issuer claim type")
	}
	issuer = strings.TrimSpace(issuer)
	if issuer == "" {
		return "", false, nil
	}
	return issuer, true, nil
}

func audiencesFromClaims(claims jwt.MapClaims) ([]string, bool, error) {
	raw, ok := claims["aud"]
	if !ok || raw == nil {
		return nil, false, nil
	}

	switch v := raw.(type) {
	case string:
		aud := strings.TrimSpace(v)
		if aud == "" {
			return nil, false, nil
		}
		return []string{aud}, true, nil
	case []string:
		audiences := make([]string, 0, len(v))
		for _, entry := range v {
			aud := strings.TrimSpace(entry)
			if aud != "" {
				audiences = append(audiences, aud)
			}
		}
		if len(audiences) == 0 {
			return nil, false, nil
		}
		return audiences, true, nil
	case []any:
		audiences := make([]string, 0, len(v))
		for _, entry := range v {
			aud, ok := entry.(string)
			if !ok {
				return nil, false, fmt.Errorf("invalid token audience claim type")
			}
			aud = strings.TrimSpace(aud)
			if aud != "" {
				audiences = append(audiences, aud)
			}
		}
		if len(audiences) == 0 {
			return nil, false, nil
		}
		return audiences, true, nil
	default:
		return nil, false, fmt.Errorf("invalid token audience claim type")
	}
}

func normalizeIssuer(issuer string) string {
	return strings.TrimRight(strings.TrimSpace(issuer), "/")
}

func normalizeAudience(audience string) string {
	return strings.TrimSpace(audience)
}
