package handler

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
)

var (
	tokenRevokerMu   sync.Mutex
	tokenRevokerOnce sync.Once
	tokenRevoker     adapterauth.TokenRevoker

	errTokenRevocationStoreUnavailable = errors.New("token revocation store unavailable")
)

type tokenRevokerAdapter struct {
	client RedisClient
}

func (r tokenRevokerAdapter) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return r.client.Set(ctx, key, value, ttl)
}

func (r tokenRevokerAdapter) Get(ctx context.Context, key string) (string, error) {
	value, err := r.client.Get(ctx, key)
	if isRedisKeyNotFound(err) {
		return "", nil
	}
	return value, err
}

func isRedisKeyNotFound(err error) bool {
	return err != nil && (errors.Is(err, adapterauth.ErrTokenRevocationKeyNotFound) ||
		err.Error() == adapterauth.ErrTokenRevocationKeyNotFound.Error() ||
		err.Error() == "redis: nil")
}

func defaultTokenRevocationCheck(ctx context.Context, rawToken string) bool {
	revoker := getTokenRevoker()
	if revoker == nil {
		if IsProductionEnv() {
			GetLogger().Error("Token revocation store unavailable, denying request", nil)
			return true
		}
		GetLogger().Warn("Token revocation store unavailable, allowing request", nil)
		return false
	}

	revoked, err := adapterauth.IsTokenRevoked(ctx, revoker, rawToken)
	if err != nil {
		GetLogger().Error("Token revocation check failed, denying request", map[string]any{"error": err.Error()})
		return true
	}
	return revoked
}

// CheckTokenRevocationStrict returns an error if the token is revoked OR if the check fails.
// This implements a fail-closed security policy.
func CheckTokenRevocationStrict(ctx context.Context, rawToken string) error {
	revoker := getTokenRevoker()
	if revoker == nil {
		return errTokenRevocationStoreUnavailable
	}
	revoked, err := adapterauth.IsTokenRevoked(ctx, revoker, rawToken)
	if err != nil {
		return err
	}
	if revoked {
		return fmt.Errorf("token is revoked")
	}
	return nil
}

func getTokenRevoker() adapterauth.TokenRevoker {
	tokenRevokerMu.Lock()
	defer tokenRevokerMu.Unlock()

	if tokenRevoker != nil {
		return tokenRevoker
	}

	initialized := false
	tokenRevokerOnce.Do(func() {
		initialized = true
		client := GetRedisClient()
		if client == nil {
			GetLogger().Warn("Token revocation store unavailable", nil)
			return
		}
		tokenRevoker = tokenRevokerAdapter{client: client}
	})
	if initialized && tokenRevoker == nil {
		tokenRevokerOnce = sync.Once{}
	}

	return tokenRevoker
}
