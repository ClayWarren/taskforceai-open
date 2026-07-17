package notifications

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/notifications"
)

// PushTokenService defines the minimal interface for push token operations.
type PushTokenService interface {
	RegisterToken(ctx context.Context, input notifications.RegisterPushTokenInput) error
	UnregisterToken(ctx context.Context, userID int, token string) (int, error)
}

// RegisterHandlers registers the notifications handlers with the provided Huma API.
func RegisterHandlers(api huma.API, service PushTokenService) {
	huma.Register(api, huma.Operation{
		OperationID: "register-push-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/notifications/push-tokens",
		Summary:     "Register push token",
		Tags:        []string{"Notifications"},
	}, func(ctx context.Context, input *struct {
		Body RegisterRequest
		handler.AuthContext
	}) (*struct{ Body map[string]bool }, error) {
		err := service.RegisterToken(ctx, notifications.RegisterPushTokenInput{
			Token:      input.Body.Token,
			Platform:   input.Body.Platform,
			DeviceID:   input.Body.DeviceID,
			AppVersion: input.Body.AppVersion,
			UserID:     input.User.ID,
		})
		if err != nil {
			slog.Error("Failed to register push token", "userId", input.User.ID, "deviceId", input.Body.DeviceID, "platform", input.Body.Platform, "error", err)
			return nil, huma.Error500InternalServerError("Failed to register token")
		}
		slog.Info("Push token registered", "userId", input.User.ID, "deviceId", input.Body.DeviceID, "platform", input.Body.Platform)
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "unregister-push-token",
		Method:      http.MethodDelete,
		Path:        "/api/v1/notifications/push-tokens",
		Summary:     "Unregister push token",
		Tags:        []string{"Notifications"},
	}, func(ctx context.Context, input *struct {
		Body DeleteRequest
		handler.AuthContext
	}) (*struct{ Body map[string]bool }, error) {
		_, err := service.UnregisterToken(ctx, input.User.ID, input.Body.Token)
		if err != nil {
			slog.Error("Failed to unregister push token", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete token")
		}
		slog.Info("Push token unregistered", "userId", input.User.ID)
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})
}
