package providers

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const (
	appleIssuer  = "https://appleid.apple.com"
	jwksCacheTTL = 24 * time.Hour
	httpTimeout  = 10 * time.Second
)

var (
	appleJWKSURL              = "https://appleid.apple.com/auth/keys"
	parseAppleTokenWithClaims = jwt.ParseWithClaims
)

// AppleClaims represents the claims in an Apple identity token
type AppleClaims struct {
	jwt.RegisteredClaims
	Email          string `json:"email,omitempty"`
	EmailVerified  any    `json:"email_verified,omitempty"` // Can be bool or string
	IsPrivateEmail any    `json:"is_private_email,omitempty"`
	AuthTime       int64  `json:"auth_time,omitempty"`
	Nonce          string `json:"nonce,omitempty"`
	NonceSupported bool   `json:"nonce_supported,omitempty"`
}

// AppleProvider defines the interface for Apple authentication
type AppleProvider interface {
	VerifyIdentityToken(token string) (*AppleClaims, error)
}

// AppleClient implements Apple Sign In token verification
type AppleClient struct {
	clientID   string
	httpClient *http.Client
	jwksCache  *jwksCache
}

type jwksCache struct {
	mu        sync.RWMutex
	refreshMu sync.Mutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
}

type appleJWKS struct {
	Keys []appleJWK `json:"keys"`
}

type appleJWK struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// NewAppleClient creates a new Apple authentication client
func NewAppleClient(clientID string) *AppleClient {
	return &AppleClient{
		clientID: clientID,
		httpClient: &http.Client{
			Transport: otelhttp.NewTransport(http.DefaultTransport),
			Timeout:   httpTimeout,
		},
		jwksCache: &jwksCache{
			keys: make(map[string]*rsa.PublicKey),
		},
	}
}

// VerifyIdentityToken verifies an Apple identity token and returns the claims
func (c *AppleClient) VerifyIdentityToken(token string) (*AppleClaims, error) {
	// Parse token without verification first to get the key ID
	unverified, _, err := jwt.NewParser().ParseUnverified(token, &AppleClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	kid, ok := unverified.Header["kid"].(string)
	if !ok {
		return nil, errors.New("missing kid in token header")
	}

	// Get the public key for verification
	publicKey, err := c.getPublicKey(kid)
	if err != nil {
		return nil, fmt.Errorf("failed to get public key: %w", err)
	}

	// Parse and verify the token
	claims := &AppleClaims{}
	verified, err := parseAppleTokenWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return publicKey, nil
	}, jwt.WithIssuer(appleIssuer), jwt.WithAudience(c.clientID))

	if err != nil {
		return nil, fmt.Errorf("token verification failed: %w", err)
	}

	if invalidAppleToken(verified) {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}

func invalidAppleToken(token *jwt.Token) bool {
	return token == nil || !token.Valid
}

func (c *AppleClient) getPublicKey(kid string) (*rsa.PublicKey, error) {
	// Check cache first
	c.jwksCache.mu.RLock()
	if key, ok := c.jwksCache.keys[kid]; ok && time.Now().Before(c.jwksCache.expiresAt) {
		c.jwksCache.mu.RUnlock()
		return key, nil
	}
	c.jwksCache.mu.RUnlock()

	// Prevent concurrent refreshes
	c.jwksCache.refreshMu.Lock()
	defer c.jwksCache.refreshMu.Unlock()

	// Double check cache after acquiring refresh lock
	c.jwksCache.mu.RLock()
	if key, ok := c.jwksCache.keys[kid]; ok && time.Now().Before(c.jwksCache.expiresAt) {
		c.jwksCache.mu.RUnlock()
		return key, nil
	}
	c.jwksCache.mu.RUnlock()

	// Refresh JWKS
	if err := c.refreshJWKS(); err != nil {
		return nil, err
	}

	// Try again after refresh
	c.jwksCache.mu.RLock()
	defer c.jwksCache.mu.RUnlock()

	key, ok := c.jwksCache.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key not found for kid: %s", kid)
	}

	return key, nil
}

func (c *AppleClient) refreshJWKS() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, appleJWKSURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS fetch returned status %d", resp.StatusCode)
	}

	var jwks appleJWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey)
	for _, jwk := range jwks.Keys {
		if jwk.Kty != "RSA" {
			continue
		}

		pubKey, err := jwkToRSAPublicKey(jwk)
		if err != nil {
			continue // Skip invalid keys
		}

		keys[jwk.Kid] = pubKey
	}
	if len(keys) == 0 {
		return errors.New("JWKS response contained no usable RSA keys")
	}

	c.jwksCache.mu.Lock()
	c.jwksCache.keys = keys
	c.jwksCache.expiresAt = time.Now().Add(jwksCacheTTL)
	c.jwksCache.mu.Unlock()

	return nil
}

func jwkToRSAPublicKey(jwk appleJWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}

	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)

	if !e.IsInt64() || e.Int64() > math.MaxInt32 {
		return nil, errors.New("RSA exponent too large")
	}
	if e.Int64() <= 1 {
		return nil, errors.New("RSA exponent too small")
	}

	return &rsa.PublicKey{
		N: n,
		E: int(e.Int64()),
	}, nil
}
