package auth

import (
	"context"
	"fmt"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

type UpdateSettingsRequest struct {
	FullName             *string `json:"full_name,omitempty"`
	ThemePreference      *string `json:"theme_preference,omitempty"`
	MemoryEnabled        *bool   `json:"memory_enabled,omitempty"`
	WebSearchEnabled     *bool   `json:"web_search_enabled,omitempty"`
	CodeExecutionEnabled *bool   `json:"code_execution_enabled,omitempty"`
	NotificationsEnabled *bool   `json:"notifications_enabled,omitempty"`
	QuickModeEnabled     *bool   `json:"quick_mode_enabled,omitempty"`
	TrustLayerEnabled    *bool   `json:"trust_layer_enabled,omitempty"`
}

type SettingsResponse struct {
	Success bool `json:"success"`
}

const maxFullNameLength = 128

type boolSettingUpdate struct {
	key     string
	value   *bool
	message string
	update  func(context.Context, *db.Queries, int32, bool) error
}

type Pool interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func defaultGetPool(ctx context.Context) (Pool, error) {
	return postgres.GetPool(ctx)
}

var GetPool = defaultGetPool

// RegisterSettingsHandler registers the authenticated settings update endpoint.
func RegisterSettingsHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-auth-settings",
		Method:      http.MethodPut,
		Path:        "/api/v1/auth/settings",
		Summary:     "Update current user settings",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		Body UpdateSettingsRequest
	}) (*struct{ Body SettingsResponse }, error) {
		if err := updateSettings(ctx, input.User, input.Body); err != nil {
			return nil, err
		}
		return &struct{ Body SettingsResponse }{Body: SettingsResponse{Success: true}}, nil
	})
}

func updateSettings(ctx context.Context, user *adapterauth.AuthenticatedUser, req UpdateSettingsRequest) error {
	if user == nil {
		return huma.Error401Unauthorized("Unauthorized")
	}
	if user.ID > math.MaxInt32 {
		return huma.Error500InternalServerError("Internal error")
	}
	// #nosec G115
	userID := int32(user.ID)

	pool, err := GetPool(ctx)
	if err != nil {
		return huma.Error503ServiceUnavailable("Database unavailable")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return huma.Error500InternalServerError("Failed to start transaction")
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := db.New(tx)
	updates, err := applySettingsUpdates(ctx, qtx, userID, req)
	if err != nil {
		return err
	}

	auditSettingsUpdate(ctx, qtx, user, updates)

	if err := tx.Commit(ctx); err != nil {
		handler.GetLogger().Error("Failed to commit settings update", map[string]any{"error": err})
		return huma.Error500InternalServerError("Failed to save settings")
	}

	invalidateUserSettingsCache(ctx, userID)
	slog.Info("User settings updated", "userId", user.ID)
	return nil
}

func invalidateUserSettingsCache(ctx context.Context, userID int32) {
	redis := handler.GetRedisClient()
	if redis == nil {
		return
	}
	if _, err := redis.Del(ctx, fmt.Sprintf("user_settings:%d", userID)); err != nil {
		handler.GetLogger().Warn("Failed to invalidate user settings cache", map[string]any{
			"user_id": userID,
			"error":   err.Error(),
		})
	}
}

func applySettingsUpdates(ctx context.Context, q *db.Queries, userID int32, req UpdateSettingsRequest) (map[string]any, error) {
	updates := make(map[string]any)

	if req.FullName != nil {
		fullName := strings.TrimSpace(*req.FullName)
		if fullName == "" {
			return nil, huma.Error400BadRequest("Full name cannot be empty")
		}
		if len([]rune(fullName)) > maxFullNameLength {
			return nil, huma.Error400BadRequest("Full name must be 128 characters or fewer")
		}
		updates["full_name"] = fullName
		if _, err := q.UpdateUserFullName(ctx, db.UpdateUserFullNameParams{ID: userID, FullName: &fullName}); err != nil {
			return nil, huma.Error500InternalServerError("Failed to update full name")
		}
	}
	if req.ThemePreference != nil {
		updates["theme_preference"] = *req.ThemePreference
		if _, err := q.UpdateUserTheme(ctx, db.UpdateUserThemeParams{ID: userID, ThemePreference: *req.ThemePreference}); err != nil {
			return nil, huma.Error500InternalServerError("Failed to update theme")
		}
	}
	for _, setting := range []boolSettingUpdate{
		{key: "memory_enabled", value: req.MemoryEnabled, message: "Failed to update memory", update: updateMemoryEnabled},
		{key: "web_search_enabled", value: req.WebSearchEnabled, message: "Failed to update web search", update: updateWebSearchEnabled},
		{key: "code_execution_enabled", value: req.CodeExecutionEnabled, message: "Failed to update code execution", update: updateCodeExecutionEnabled},
		{key: "notifications_enabled", value: req.NotificationsEnabled, message: "Failed to update notifications", update: updateNotificationsEnabled},
		{key: "quick_mode_enabled", value: req.QuickModeEnabled, message: "Failed to update quick mode", update: updateQuickModeEnabled},
		{key: "trust_layer_enabled", value: req.TrustLayerEnabled, message: "Failed to update trust layer", update: updateTrustLayerEnabled},
	} {
		if setting.value == nil {
			continue
		}
		updates[setting.key] = *setting.value
		if err := setting.update(ctx, q, userID, *setting.value); err != nil {
			return nil, huma.Error500InternalServerError(setting.message)
		}
	}

	return updates, nil
}

func auditSettingsUpdate(ctx context.Context, q *db.Queries, user *adapterauth.AuthenticatedUser, updates map[string]any) {
	if len(updates) == 0 {
		return
	}
	uid := strconv.Itoa(user.ID)
	auth.NewAuditService(auth.NewAuditLogRepository(q)).LogEvent(ctx, auth.AuditLogWrite{
		UserID:   &uid,
		Email:    &user.Email,
		Action:   "UPDATE",
		Resource: "user_settings",
		Details:  updates,
		Success:  true,
	})
}

func updateMemoryEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserMemoryEnabled(ctx, db.UpdateUserMemoryEnabledParams{ID: id, MemoryEnabled: v})
	return err
}

func updateWebSearchEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserWebSearchEnabled(ctx, db.UpdateUserWebSearchEnabledParams{ID: id, WebSearchEnabled: v})
	return err
}

func updateCodeExecutionEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserCodeExecutionEnabled(ctx, db.UpdateUserCodeExecutionEnabledParams{ID: id, CodeExecutionEnabled: v})
	return err
}

func updateNotificationsEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserNotificationsEnabled(ctx, db.UpdateUserNotificationsEnabledParams{ID: id, NotificationsEnabled: v})
	return err
}

func updateQuickModeEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserQuickModeEnabled(ctx, db.UpdateUserQuickModeEnabledParams{ID: id, QuickModeEnabled: v})
	return err
}

func updateTrustLayerEnabled(ctx context.Context, q *db.Queries, id int32, v bool) error {
	_, err := q.UpdateUserTrustLayerEnabled(ctx, db.UpdateUserTrustLayerEnabledParams{ID: id, TrustLayerEnabled: v})
	return err
}
