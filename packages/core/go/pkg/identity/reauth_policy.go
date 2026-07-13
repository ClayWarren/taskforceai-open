package identity

import (
	"errors"
	"time"
)

// ErrReauthRequired indicates the session token was not issued recently
// enough (or its issue time is unknown or implausible) for a sensitive
// operation.
var ErrReauthRequired = errors.New("identity: recent re-authentication required")

const (
	// DefaultAdminReauthMaxAge is how recently an admin must have
	// authenticated before performing sensitive operations.
	DefaultAdminReauthMaxAge = 30 * time.Minute
	// DefaultReauthMaxFutureClockSkew tolerates tokens issued slightly in
	// the future by a drifting clock.
	DefaultReauthMaxFutureClockSkew = 2 * time.Minute
)

// ReauthPolicy decides whether a session token was issued recently enough
// for a sensitive operation.
type ReauthPolicy struct {
	MaxAge             time.Duration
	MaxFutureClockSkew time.Duration
}

// DefaultAdminReauthPolicy returns the standard policy for sensitive admin
// operations.
func DefaultAdminReauthPolicy() ReauthPolicy {
	return ReauthPolicy{
		MaxAge:             DefaultAdminReauthMaxAge,
		MaxFutureClockSkew: DefaultReauthMaxFutureClockSkew,
	}
}

// Validate reports ErrReauthRequired unless tokenIssuedAt is known, not
// implausibly far in the future, and within MaxAge of now.
func (p ReauthPolicy) Validate(tokenIssuedAt, now time.Time) error {
	if tokenIssuedAt.IsZero() {
		return ErrReauthRequired
	}
	if tokenIssuedAt.After(now.Add(p.MaxFutureClockSkew)) {
		return ErrReauthRequired
	}
	if now.Sub(tokenIssuedAt) > p.MaxAge {
		return ErrReauthRequired
	}
	return nil
}
