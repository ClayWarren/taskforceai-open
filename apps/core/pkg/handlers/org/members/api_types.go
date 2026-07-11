package members

import "github.com/TaskForceAI/core/pkg/identity"

// UpdateRoleRequest represents a request to update a member's role.
type UpdateRoleRequest struct {
	Role identity.OrganizationRole `json:"role" enum:"admin,member,viewer,owner" doc:"New role for the member"`
}
