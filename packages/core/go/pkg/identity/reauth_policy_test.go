package identity

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReauthPolicyValidate(t *testing.T) {
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	policy := DefaultAdminReauthPolicy()

	tests := []struct {
		name     string
		issuedAt time.Time
		wantErr  bool
	}{
		{name: "unknown issue time", issuedAt: time.Time{}, wantErr: true},
		{name: "issued beyond clock skew", issuedAt: now.Add(3 * time.Minute), wantErr: true},
		{name: "issued too long ago", issuedAt: now.Add(-31 * time.Minute), wantErr: true},
		{name: "issued within clock skew", issuedAt: now.Add(time.Minute), wantErr: false},
		{name: "recently issued", issuedAt: now.Add(-29 * time.Minute), wantErr: false},
		{name: "issued exactly at max age", issuedAt: now.Add(-30 * time.Minute), wantErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := policy.Validate(tt.issuedAt, now)
			if tt.wantErr {
				require.ErrorIs(t, err, ErrReauthRequired)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestDefaultAdminReauthPolicy(t *testing.T) {
	policy := DefaultAdminReauthPolicy()
	assert.Equal(t, DefaultAdminReauthMaxAge, policy.MaxAge)
	assert.Equal(t, DefaultReauthMaxFutureClockSkew, policy.MaxFutureClockSkew)
}
