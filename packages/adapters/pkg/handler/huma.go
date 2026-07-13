package handler

import (
	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/auth"
)

// AuthContext can be embedded in Huma input structs to automatically extract auth info.
// If the user is missing, it returns a 401 Unauthorized error.
type AuthContext struct {
	User  *auth.AuthenticatedUser `doc:"Authenticated user"`
	OrgID int                     `doc:"Organization ID"`
}

// Resolve implements the huma.Resolver interface.
func (a *AuthContext) Resolve(ctx huma.Context) []error {
	user, ok := ctx.Context().Value(UserContextKey).(*auth.AuthenticatedUser)
	if !ok || user == nil {
		return []error{huma.Error401Unauthorized("Unauthorized")}
	}
	a.User = user
	a.OrgID, _ = ctx.Context().Value(OrgIDContextKey).(int)
	return nil
}

// SessionAuthContext resolves authenticated session/JWT users and rejects
// developer API-key authentication.
type SessionAuthContext struct {
	AuthContext
}

// Resolve implements the huma.Resolver interface.
func (a *SessionAuthContext) Resolve(ctx huma.Context) []error {
	if errs := a.AuthContext.Resolve(ctx); len(errs) > 0 {
		return errs
	}
	if method, _ := ctx.Context().Value(AuthMethodContextKey).(string); method == AuthMethodAPIKey {
		return []error{huma.Error403Forbidden("Session authentication required")}
	}
	return nil
}

// OptionalAuthContext attempts to extract auth info but does NOT error if missing.
type OptionalAuthContext struct {
	User  *auth.AuthenticatedUser `doc:"Authenticated user (optional)"`
	OrgID int                     `doc:"Organization ID"`
}

// Resolve implements the huma.Resolver interface.
func (a *OptionalAuthContext) Resolve(ctx huma.Context) []error {
	user, ok := ctx.Context().Value(UserContextKey).(*auth.AuthenticatedUser)
	if ok {
		a.User = user
	}
	a.OrgID, _ = ctx.Context().Value(OrgIDContextKey).(int)
	return nil
}

// AdminAuthContext resolves authenticated admin users for Huma handlers.
type AdminAuthContext struct {
	AuthContext
}

// Resolve implements the huma.Resolver interface.
func (a *AdminAuthContext) Resolve(ctx huma.Context) []error {
	if errs := a.AuthContext.Resolve(ctx); len(errs) > 0 {
		return errs
	}
	if !a.User.IsAdmin {
		return []error{huma.Error403Forbidden("Admin access required")}
	}
	return nil
}
