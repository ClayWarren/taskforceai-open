package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

// RegisterMeHandler registers the /me endpoint with Huma.
func RegisterMeHandler(api huma.API, userRepo auth.AuthUserRepository) {
	huma.Register(api, huma.Operation{
		OperationID: "get-me",
		Method:      http.MethodGet,
		Path:        "/api/v1/auth/me",
		Summary:     "Get current user profile",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*struct {
		Body auth.AuthenticatedUserResponse
	}, error) {
		dbUser, err := userRepo.FindByID(ctx, input.User.ID)
		if err != nil {
			if errors.Is(err, auth.ErrUserNotFound) {
				handler.GetLogger().Warn("user lookup failed: token is valid but ID not found in database", map[string]any{
					"userId": input.User.ID,
					"email":  input.User.Email,
				})
				return nil, huma.Error404NotFound(fmt.Sprintf("User not found: %d", input.User.ID))
			}
			handler.GetLogger().Error("failed to resolve current user", map[string]any{
				"error":  err,
				"userId": input.User.ID,
			})
			return nil, huma.Error500InternalServerError("Failed to resolve current user")
		}

		if dbUser == nil {
			handler.GetLogger().Warn("user lookup failed: token is valid but ID not found in database", map[string]any{
				"userId": input.User.ID,
				"email":  input.User.Email,
			})
			return nil, huma.Error404NotFound(fmt.Sprintf("User not found: %d", input.User.ID))
		}

		// Pass impersonator from token if present
		dbUser.ImpersonatorID = input.User.ImpersonatorID

		return &struct {
			Body auth.AuthenticatedUserResponse
		}{Body: auth.MapUserToResponse(dbUser)}, nil
	})
}
