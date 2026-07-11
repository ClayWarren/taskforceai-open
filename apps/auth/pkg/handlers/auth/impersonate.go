package auth

import (
	"context"
	"errors"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var getQueries = appdatabase.GetQueries

type ImpersonateRequest struct {
	UserEmail string `json:"email" validate:"required,email"`
}

// ImpersonateHandler handles /api/v1/auth/impersonate
// Must be called by an authenticated Super Admin.
func ImpersonateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	actor := handler.GetAuthenticatedUser(r)
	if actor == nil {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Defense in depth: block explicit token reuse if the token was revoked
	// after auth context was established.
	rawToken := handler.ExtractToken(r)
	if rawToken != "" && adapterhandler.IsTokenRevoked != nil && adapterhandler.IsTokenRevoked(r.Context(), rawToken) {
		handler.GetLogger().Warn("Rejected impersonation request with revoked token", map[string]any{
			"actor_email": actor.Email,
		})
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	q, ok := handler.RequireQueriesWithStatus(
		w,
		r,
		nil,
		http.StatusServiceUnavailable,
		"Database unavailable",
	)
	if !ok {
		return
	}

	// Double check admin status from DB
	dbActor, err := q.GetUserByEmail(r.Context(), actor.Email)
	if err != nil {
		handler.GetLogger().Error("Failed to load admin user", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusInternalServerError, "Server error")
		return
	}

	policy := impersonationPolicy()
	actorUser := auth.ImpersonationUser{IsAdmin: dbActor.IsAdmin, Disabled: dbActor.Disabled}
	if err := policy.AuthorizeActor(actorUser, tokenIssuedAt(r.Context()), time.Now()); err != nil {
		switch {
		case errors.Is(err, auth.ErrImpersonationActorNotAdmin):
			handler.JSONError(w, http.StatusForbidden, "Admin access required")
		default:
			handler.JSONError(w, http.StatusForbidden, "Admin re-authentication required for this operation")
		}
		return
	}

	var req ImpersonateRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return
	}

	targetUser, err := q.GetUserByEmail(r.Context(), req.UserEmail)
	if err != nil {
		if handler.HandleNotFound(w, err, "Target user not found") {
			return
		}
		handler.GetLogger().Error("Failed to load target user", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusInternalServerError, "Server error")
		return
	}
	target := auth.ImpersonationUser{IsAdmin: targetUser.IsAdmin, Disabled: targetUser.Disabled}
	if err := policy.ValidateTarget(target); err != nil {
		switch {
		case errors.Is(err, auth.ErrImpersonationTargetAdmin):
			handler.JSONError(w, http.StatusForbidden, "Cannot impersonate admin users")
		default:
			handler.JSONError(w, http.StatusForbidden, "Cannot impersonate disabled users")
		}
		return
	}

	impersonatorID := strconv.Itoa(int(dbActor.ID))
	sessionUser := auth.SessionUser{
		ID:             strconv.Itoa(int(targetUser.ID)),
		Email:          targetUser.Email,
		ImpersonatorID: &impersonatorID,
	}
	if targetUser.FullName != nil {
		sessionUser.FullName = *targetUser.FullName
	}

	token, err := auth.EncodeSessionToken(sessionUser, os.Getenv("AUTH_SECRET"), auth.ImpersonationSessionTTLSeconds)
	if err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	isSecure := (strings.TrimSpace(os.Getenv("NODE_ENV")) == "production" || os.Getenv("VERCEL") != "")
	auth.ApplySessionCookies(w, token, sessionUser, isSecure, auth.ImpersonationSessionTTLSeconds)

	targetUserID := strconv.Itoa(int(targetUser.ID))
	auth.NewAuditService(auth.NewAuditLogRepository(q)).LogEvent(r.Context(), auth.AuditLogWrite{
		UserID:     &impersonatorID,
		Email:      &dbActor.Email,
		Action:     "IMPERSONATION_START",
		Resource:   "user",
		ResourceID: &targetUserID,
		IPAddress:  handler.GetClientIP(r),
		UserAgent:  handler.GetUserAgent(r),
		Details: map[string]any{
			"actor_email":    dbActor.Email,
			"target_email":   targetUser.Email,
			"target_user_id": targetUser.ID,
		},
		Success: true,
	})
	handler.GetLogger().Info("Support impersonation started", map[string]any{
		"actor_email":  dbActor.Email,
		"target_email": targetUser.Email,
		"action":       "impersonation_start",
	})

	handler.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Now impersonating " + targetUser.Email,
	})
}

// tokenIssuedAt extracts the actor token's issued-at time from the request
// context; it returns the zero time when the value is missing or malformed.
func tokenIssuedAt(ctx context.Context) time.Time {
	raw := ctx.Value(adapterhandler.TokenIssuedAtContextKey)
	var issuedAtUnix int64
	switch v := raw.(type) {
	case int64:
		issuedAtUnix = v
	case int:
		issuedAtUnix = int64(v)
	default:
		return time.Time{}
	}
	return time.Unix(issuedAtUnix, 0)
}

func impersonationPolicy() auth.ImpersonationPolicy {
	return auth.ImpersonationPolicy{
		Reauth: coreidentity.ReauthPolicy{
			MaxAge:             impersonationReauthMaxAge(),
			MaxFutureClockSkew: coreidentity.DefaultReauthMaxFutureClockSkew,
		},
	}
}

func impersonationReauthMaxAge() time.Duration {
	value := os.Getenv("ADMIN_REAUTH_MAX_AGE_MINUTES")
	if value == "" {
		return coreidentity.DefaultAdminReauthMaxAge
	}

	minutes, err := strconv.Atoi(value)
	if err != nil || minutes <= 0 {
		return coreidentity.DefaultAdminReauthMaxAge
	}
	return time.Duration(minutes) * time.Minute
}
