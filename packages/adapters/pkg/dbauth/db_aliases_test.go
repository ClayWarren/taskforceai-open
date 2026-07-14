package dbauth

import "github.com/TaskForceAI/adapters/pkg/db"

type Queries = db.Queries
type GetAPIKeyWithUserByHashRow = db.GetAPIKeyWithUserByHashRow
type UpdateUserAdminByEmailParams = db.UpdateUserAdminByEmailParams
type Organization = db.Organization
type GetMembershipParams = db.GetMembershipParams
type User = db.User
type Membership = db.Membership
type DeveloperApiTier = db.DeveloperApiTier

const (
	OrganizationRoleMEMBER     = db.OrganizationRoleMEMBER
	OrganizationRoleOWNER      = db.OrganizationRoleOWNER
	DeveloperApiTierSTARTER    = db.DeveloperApiTierSTARTER
	DeveloperApiTierPRO        = db.DeveloperApiTierPRO
	DeveloperApiTierENTERPRISE = db.DeveloperApiTierENTERPRISE
)

var New = db.New
