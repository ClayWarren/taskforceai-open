package handler

import (
	"math"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/danielgtaylor/huma/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveAuthIDs(t *testing.T) {
	tests := []struct {
		name       string
		user       *auth.AuthenticatedUser
		orgID      int
		wantStatus int
		assertIDs  func(*testing.T, AuthIDs)
	}{
		{
			name:       "missing user",
			user:       nil,
			wantStatus: 401,
		},
		{
			name:       "zero user ID",
			user:       &auth.AuthenticatedUser{},
			wantStatus: 400,
		},
		{
			name:       "overflow user ID",
			user:       &auth.AuthenticatedUser{ID: math.MaxInt32 + 1},
			wantStatus: 400,
		},
		{
			name:       "negative organization ID",
			user:       &auth.AuthenticatedUser{ID: 42},
			orgID:      -1,
			wantStatus: 400,
		},
		{
			name:       "overflow organization ID",
			user:       &auth.AuthenticatedUser{ID: 42},
			orgID:      math.MaxInt32 + 1,
			wantStatus: 400,
		},
		{
			name:  "personal scope",
			user:  &auth.AuthenticatedUser{ID: 42},
			orgID: 0,
			assertIDs: func(t *testing.T, ids AuthIDs) {
				t.Helper()
				assert.Equal(t, 42, ids.UserID)
				assert.Equal(t, int32(42), ids.UserID32)
				assert.Equal(t, "42", ids.UserIDString)
				assert.Equal(t, 0, ids.OrgID)
				assert.Nil(t, ids.OrgID32)
				assert.Nil(t, ids.OrgIDInt)
			},
		},
		{
			name:  "organization scope",
			user:  &auth.AuthenticatedUser{ID: 42},
			orgID: 7,
			assertIDs: func(t *testing.T, ids AuthIDs) {
				t.Helper()
				assert.Equal(t, 42, ids.UserID)
				assert.Equal(t, int32(42), ids.UserID32)
				assert.Equal(t, "42", ids.UserIDString)
				assert.Equal(t, 7, ids.OrgID)
				require.NotNil(t, ids.OrgID32)
				require.NotNil(t, ids.OrgIDInt)
				assert.Equal(t, int32(7), *ids.OrgID32)
				assert.Equal(t, 7, *ids.OrgIDInt)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ids, err := ResolveAuthIDs(tt.user, tt.orgID)
			if tt.wantStatus != 0 {
				require.Error(t, err)
				assert.Equal(t, tt.wantStatus, humaStatus(t, err))
				return
			}

			require.NoError(t, err)
			tt.assertIDs(t, ids)
		})
	}
}

func TestResolveOrgAuthIDsRequiresOrganizationContext(t *testing.T) {
	_, err := ResolveOrgAuthIDs(nil, 7)
	require.Error(t, err)
	assert.Equal(t, 401, humaStatus(t, err))

	_, err = ResolveOrgAuthIDs(&auth.AuthenticatedUser{ID: 42}, 0)
	require.Error(t, err)
	assert.Equal(t, 403, humaStatus(t, err))

	ids, err := ResolveOrgAuthIDs(&auth.AuthenticatedUser{ID: 42}, 7)
	require.NoError(t, err)
	require.NotNil(t, ids.OrgID32)
	assert.Equal(t, int32(7), *ids.OrgID32)
}

func humaStatus(t *testing.T, err error) int {
	t.Helper()

	var statusErr huma.StatusError
	require.ErrorAs(t, err, &statusErr, "expected Huma status error: %v", err)
	return statusErr.GetStatus()
}
