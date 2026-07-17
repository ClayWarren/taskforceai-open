package auth

import (
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/danielgtaylor/huma/v2"
)

// RegisterHandlers registers all auth handlers.
func RegisterHandlers(api huma.API, q auth.AuthUserRepository) {
	RegisterMeHandler(api, q)
	RegisterSettingsHandler(api)
}
