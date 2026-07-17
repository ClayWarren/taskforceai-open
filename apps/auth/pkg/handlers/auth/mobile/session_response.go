package mobile

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	authmfa "github.com/TaskForceAI/auth-service/pkg/handlers/auth/mfa"
)

var createPendingMobileLoginToken = authmfa.PendingLoginToken

func handleOAuthLinkError(
	w http.ResponseWriter,
	r *http.Request,
	err error,
	auditLog *auth.AuditService,
	provider string,
	missingEmailMessage string,
) {
	switch {
	case errors.Is(err, errOAuthEmailRequired):
		logLoginFailure(r, nil, err.Error(), auditLog)
		handler.JSONError(w, http.StatusBadRequest, missingEmailMessage)
	case errors.Is(err, errOAuthSubjectRequired):
		logLoginFailure(r, nil, err.Error(), auditLog)
		handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
	case errors.Is(err, auth.ErrUserDisabled):
		logLoginFailure(r, nil, err.Error(), auditLog)
		handler.JSONError(w, http.StatusForbidden, "Account is disabled")
	default:
		handler.GetLogger().Error("Failed to link "+provider+" account", map[string]any{"error": err.Error()})
		logLoginFailure(r, nil, "Account mapping failed", auditLog)
		handler.JSONError(w, http.StatusInternalServerError, "Failed to process account")
	}
}

func writeMobileSessionResponse(
	w http.ResponseWriter,
	r *http.Request,
	user *auth.AuthUser,
	auditLog *auth.AuditService,
	provider string,
) {
	writeMobileSessionResponseAt(w, r, user, auditLog, provider, time.Time{})
}

func writeMobileSessionResponseAt(
	w http.ResponseWriter,
	r *http.Request,
	user *auth.AuthUser,
	auditLog *auth.AuditService,
	provider string,
	authenticatedAt time.Time,
) {
	sessionUser := auth.BuildSessionPayload(user)
	if !authenticatedAt.IsZero() && authenticatedAt.Unix() > 0 {
		sessionUser.AuthenticatedAt = &authenticatedAt
	}
	if user.MFAEnabled {
		pendingToken, err := createPendingMobileLoginToken(sessionUser, "")
		if err != nil {
			handler.GetLogger().Error("Failed to generate mobile "+provider+" MFA token", map[string]any{"error": err.Error(), "user_id": user.ID})
			logLoginFailure(r, user, "Failed to start MFA challenge", auditLog)
			handler.JSONError(w, http.StatusInternalServerError, "Failed to start MFA challenge")
			return
		}
		handler.JSON(w, http.StatusOK, map[string]any{
			"mfa_required": true,
			"mfa_token":    pendingToken,
			"user":         auth.MapUserToResponse(user),
		})
		return
	}

	signedToken, err := auth.EncodeSessionToken(
		sessionUser,
		strings.TrimSpace(os.Getenv("AUTH_SECRET")),
		auth.DefaultSessionMaxAge,
	)
	if err != nil {
		handler.GetLogger().Error("Failed to generate mobile "+provider+" session token", map[string]any{"error": err.Error()})
		logLoginFailure(r, user, "Failed to create session", auditLog)
		handler.JSONError(w, http.StatusInternalServerError, "Failed to create session")
		return
	}

	logLoginSuccess(r, user, auditLog)
	handler.JSON(w, http.StatusOK, map[string]any{
		"access_token": signedToken,
		"user":         auth.MapUserToResponse(user),
	})
}

func requireMobileAuthQueries(
	w http.ResponseWriter,
	r *http.Request,
	getQueries func(ctx context.Context) (*db.Queries, error),
	auditLog *auth.AuditService,
) (*db.Queries, *auth.AuditService, bool) {
	q, ok := handler.RequireQueriesWithStatus(
		w,
		r,
		getQueries,
		http.StatusServiceUnavailable,
		"Database unavailable",
	)
	if !ok {
		logLoginFailure(r, nil, "Database unavailable", auditLog)
		return nil, auditLog, false
	}
	if auditLog == nil {
		auditLog = auth.NewAuditService(auth.NewAuditLogRepository(q))
	}
	return q, auditLog, true
}
