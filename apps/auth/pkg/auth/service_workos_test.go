package auth

import (
	"context"

	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

// LinkOrCreateWorkOSUser keeps legacy test scenarios readable while the
// production boundary accepts a provider-neutral identity.
func (s *LinkerService) LinkOrCreateWorkOSUser(ctx context.Context, user usermanagement.User) (*AuthUser, error) {
	return s.LinkOrCreateExternalUser(ctx, ExternalIdentity{
		Provider:   "workos",
		ProviderID: user.ID,
		Email:      user.Email,
		FirstName:  user.FirstName,
		LastName:   user.LastName,
	})
}
