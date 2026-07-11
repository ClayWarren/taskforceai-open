package auth

import (
	"errors"
	"time"

	coreidentity "github.com/TaskForceAI/core/pkg/identity"
)

var (
	ErrImpersonationActorNotAdmin  = errors.New("impersonation: admin access required")
	ErrImpersonationReauthRequired = errors.New("impersonation: admin re-authentication required")
	ErrImpersonationTargetAdmin    = errors.New("impersonation: cannot impersonate admin users")
	ErrImpersonationTargetDisabled = errors.New("impersonation: cannot impersonate disabled users")
)

// ImpersonationSessionTTLSeconds caps how long an impersonation session may live.
const ImpersonationSessionTTLSeconds = 1800

// ImpersonationUser carries the account flags the impersonation rules decide on.
type ImpersonationUser struct {
	IsAdmin  bool
	Disabled bool
}

// ImpersonationPolicy holds the business rules for support impersonation:
// only recently re-authenticated, enabled admins may impersonate, and only
// enabled non-admin accounts may be impersonated.
type ImpersonationPolicy struct {
	// Reauth is how recently the actor must have authenticated.
	Reauth coreidentity.ReauthPolicy
}

// AuthorizeActor checks that the actor is an enabled admin whose token was
// issued recently enough. tokenIssuedAt is the zero time when unknown.
func (p ImpersonationPolicy) AuthorizeActor(actor ImpersonationUser, tokenIssuedAt, now time.Time) error {
	if !actor.IsAdmin || actor.Disabled {
		return ErrImpersonationActorNotAdmin
	}
	if err := p.Reauth.Validate(tokenIssuedAt, now); err != nil {
		return ErrImpersonationReauthRequired
	}
	return nil
}

// ValidateTarget checks that the target account may be impersonated.
func (p ImpersonationPolicy) ValidateTarget(target ImpersonationUser) error {
	if target.IsAdmin {
		return ErrImpersonationTargetAdmin
	}
	if target.Disabled {
		return ErrImpersonationTargetDisabled
	}
	return nil
}
