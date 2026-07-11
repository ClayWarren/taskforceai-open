package handler

import (
	"math"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/auth"
)

// AuthIDs carries the common user and organization ID forms used by Huma handlers.
type AuthIDs struct {
	UserID       int
	UserID32     int32
	UserIDString string
	OrgID        int
	OrgID32      *int32
	OrgIDInt     *int
}

// ResolveAuthIDs converts authenticated request IDs once, with bounds checks.
func ResolveAuthIDs(user *auth.AuthenticatedUser, orgID int) (AuthIDs, error) {
	if user == nil {
		return AuthIDs{}, huma.Error401Unauthorized("Unauthorized")
	}
	if user.ID <= 0 || user.ID > math.MaxInt32 {
		return AuthIDs{}, huma.Error400BadRequest("Invalid user ID")
	}
	if orgID < 0 || orgID > math.MaxInt32 {
		return AuthIDs{}, huma.Error400BadRequest("Invalid organization ID")
	}

	ids := AuthIDs{
		UserID:       user.ID,
		UserID32:     int32(user.ID), // #nosec G115 -- user.ID range checked above.
		UserIDString: strconv.Itoa(user.ID),
		OrgID:        orgID,
	}
	if orgID != 0 {
		orgID32 := int32(orgID) // #nosec G115 -- orgID range checked above.
		ids.OrgID32 = &orgID32

		orgIDInt := orgID
		ids.OrgIDInt = &orgIDInt
	}
	return ids, nil
}

// ResolveOrgAuthIDs converts authenticated IDs and requires organization context.
func ResolveOrgAuthIDs(user *auth.AuthenticatedUser, orgID int) (AuthIDs, error) {
	ids, err := ResolveAuthIDs(user, orgID)
	if err != nil {
		return AuthIDs{}, err
	}
	if ids.OrgID32 == nil {
		return AuthIDs{}, huma.Error403Forbidden("Organization context required")
	}
	return ids, nil
}
