package identity

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveSessionMaxAgeSeconds(t *testing.T) {
	tests := []struct {
		name    string
		context SessionPolicyContext
		want    int
	}{
		{
			name:    "consumer",
			context: SessionPolicyContext{},
			want:    ConsumerSessionMaxAgeSeconds,
		},
		{
			name:    "enterprise organization",
			context: SessionPolicyContext{HasOrganization: true},
			want:    EnterpriseSessionMaxAgeSeconds,
		},
		{
			name:    "impersonation overrides consumer",
			context: SessionPolicyContext{IsImpersonated: true},
			want:    ImpersonationSessionMaxAgeSeconds,
		},
		{
			name:    "impersonation overrides enterprise",
			context: SessionPolicyContext{HasOrganization: true, IsImpersonated: true},
			want:    ImpersonationSessionMaxAgeSeconds,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ResolveSessionMaxAgeSeconds(tt.context))
		})
	}
}

func TestSessionPolicyDurations(t *testing.T) {
	assert.Equal(t, 30*24*60*60, ConsumerSessionMaxAgeSeconds)
	assert.Equal(t, 12*60*60, EnterpriseSessionMaxAgeSeconds)
	assert.Equal(t, 60*60, ImpersonationSessionMaxAgeSeconds)
	assert.Equal(t, 5*60, MFAPendingSessionMaxAgeSeconds)
}
