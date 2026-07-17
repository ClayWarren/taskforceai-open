package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenRevoker defines the interface for token revocation storage.
type TokenRevoker interface {
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Get(ctx context.Context, key string) (string, error)
}

const revokedKeyPrefix = "token:revoked:"

// tokenKeyFromRaw returns a Redis key based on the SHA256 hash of the raw token string.
func tokenKeyFromRaw(rawToken string) string {
	h := sha256.Sum256([]byte(rawToken))
	return fmt.Sprintf("%s%x", revokedKeyPrefix, h)
}

// RevokeToken stores a token in the revocation blacklist.
// The entry expires when the token itself would expire, so the blacklist is self-cleaning.
func RevokeToken(ctx context.Context, store TokenRevoker, rawToken string, claims jwt.MapClaims) error {
	key := tokenKeyFromRaw(rawToken)

	// Determine remaining TTL from the "exp" claim.
	ttl := time.Duration(0)
	if exp, ok := claims["exp"].(float64); ok {
		remaining := time.Until(time.Unix(int64(exp), 0))
		if remaining > 0 {
			ttl = remaining
		}
	}

	// If no valid expiration or already expired, use a short default TTL
	// so the key still gets cleaned up. Returning nil here without storing
	// would make RevokeToken a silent no-op for tokens without an exp claim.
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	return store.Set(ctx, key, []byte("1"), ttl)
}

// IsTokenRevoked checks whether a token has been revoked.
// Returns (true, nil) if revoked, (false, nil) if not revoked, and (false, err) if the store check failed.
func IsTokenRevoked(ctx context.Context, store TokenRevoker, rawToken string) (bool, error) {
	if store == nil {
		return false, nil
	}
	key := tokenKeyFromRaw(rawToken)
	val, err := store.Get(ctx, key)
	if err != nil {
		if isRevocationKeyNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return val != "", nil
}

func isRevocationKeyNotFound(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrTokenRevocationKeyNotFound) ||
		err.Error() == ErrTokenRevocationKeyNotFound.Error() ||
		err.Error() == "redis: nil"
}

var ErrTokenRevocationKeyNotFound = errors.New("key not found")
