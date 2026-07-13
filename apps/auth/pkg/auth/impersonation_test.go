package auth

import (
	"testing"
	"time"

	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	"github.com/stretchr/testify/require"
)

func testImpersonationPolicy() ImpersonationPolicy {
	return ImpersonationPolicy{
		Reauth: coreidentity.ReauthPolicy{
			MaxAge:             30 * time.Minute,
			MaxFutureClockSkew: 2 * time.Minute,
		},
	}
}

func TestImpersonationPolicy_AuthorizeActor(t *testing.T) {
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	admin := ImpersonationUser{IsAdmin: true}

	tests := []struct {
		name     string
		actor    ImpersonationUser
		issuedAt time.Time
		wantErr  error
	}{
		{"NonAdmin", ImpersonationUser{}, now, ErrImpersonationActorNotAdmin},
		{"DisabledAdmin", ImpersonationUser{IsAdmin: true, Disabled: true}, now, ErrImpersonationActorNotAdmin},
		{"UnknownIssuedAt", admin, time.Time{}, ErrImpersonationReauthRequired},
		{"IssuedBeyondClockSkew", admin, now.Add(3 * time.Minute), ErrImpersonationReauthRequired},
		{"IssuedTooLongAgo", admin, now.Add(-31 * time.Minute), ErrImpersonationReauthRequired},
		{"IssuedWithinClockSkew", admin, now.Add(time.Minute), nil},
		{"RecentlyIssued", admin, now.Add(-29 * time.Minute), nil},
		{"IssuedExactlyAtMaxAge", admin, now.Add(-30 * time.Minute), nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := testImpersonationPolicy().AuthorizeActor(tt.actor, tt.issuedAt, now)
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func TestImpersonationPolicy_ValidateTarget(t *testing.T) {
	tests := []struct {
		name    string
		target  ImpersonationUser
		wantErr error
	}{
		{"Admin", ImpersonationUser{IsAdmin: true}, ErrImpersonationTargetAdmin},
		{"Disabled", ImpersonationUser{Disabled: true}, ErrImpersonationTargetDisabled},
		{"DisabledAdmin", ImpersonationUser{IsAdmin: true, Disabled: true}, ErrImpersonationTargetAdmin},
		{"EnabledNonAdmin", ImpersonationUser{}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := testImpersonationPolicy().ValidateTarget(tt.target)
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}
