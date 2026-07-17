//go:build !production

package auth

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

type TestLoginRequest struct {
	Email string `json:"email" validate:"required,email"`
}

// TestLoginHandler handles bypass login for E2E tests.
// ONLY ACTIVE outside production when GO_ENV=test or ENABLE_TEST_LOGIN=true.
func TestLoginHandler(w http.ResponseWriter, r *http.Request) {
	if handler.IsProductionEnv() || !isTestLoginEnabled() {
		handler.JSONError(w, http.StatusForbidden, "Only available in test environment")
		return
	}

	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req TestLoginRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return
	}

	q, ok := handler.RequireQueriesWithStatus(w, r, nil, http.StatusServiceUnavailable, "Database unavailable")
	if !ok {
		return
	}

	userRepo := auth.NewAuthUserRepository(q)
	user, ok := resolveTestLoginUser(w, r, q, userRepo, req.Email)
	if !ok {
		return
	}

	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		handler.GetLogger().Error("AUTH_SECRET not configured", nil)
		handler.JSONError(w, http.StatusInternalServerError, "Server configuration error")
		return
	}

	sessionPayload := auth.BuildSessionPayload(user)
	token, err := auth.EncodeSessionToken(sessionPayload, secret, auth.DefaultSessionMaxAge)
	if err != nil {
		handler.GetLogger().Error("failed to generate token in test login", map[string]any{
			"error": err,
		})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	isSecure := handler.IsProductionEnv()
	auth.ApplySessionCookies(w, token, sessionPayload, isSecure)

	// Audit successful login
	auditService := auth.NewAuditService(auth.NewAuditLogRepository(q))
	auditService.LogLogin(r.Context(), user, true, handler.GetClientIP(r), handler.GetUserAgent(r), nil)

	handler.JSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"user":  user,
		"token": token,
	})
}

func isTestLoginEnabled() bool {
	return isGoTestBinary() &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "test") &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("ENABLE_TEST_LOGIN")), "true")
}

func isGoTestBinary() bool {
	return strings.HasSuffix(os.Args[0], ".test")
}

func resolveTestLoginUser(w http.ResponseWriter, r *http.Request, q *db.Queries, userRepo auth.AuthUserRepository, email string) (*auth.AuthUser, bool) {
	user, err := userRepo.FindByEmail(r.Context(), email)
	if err != nil {
		if errors.Is(err, auth.ErrUserNotFound) {
			return createTestLoginUser(w, r, q, userRepo, email)
		}
		if handler.HandleNotFound(w, err, "User not found") {
			return nil, false
		}
		handler.GetLogger().Error("failed to resolve user in test login", map[string]any{
			"error": err,
			"email": handler.MaskEmail(email),
		})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to resolve user")
		return nil, false
	}
	if user != nil {
		return user, true
	}
	return createTestLoginUser(w, r, q, userRepo, email)
}

func createTestLoginUser(w http.ResponseWriter, r *http.Request, q *db.Queries, userRepo auth.AuthUserRepository, email string) (*auth.AuthUser, bool) {
	fullName := "Local Dev"
	if _, err := q.CreateUser(r.Context(), db.CreateUserParams{
		Email:    email,
		FullName: &fullName,
		Plan:     "super",
	}); err != nil {
		handler.GetLogger().Error("failed to create test-login user", map[string]any{
			"error": err,
			"email": handler.MaskEmail(email),
		})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to create local user")
		return nil, false
	}

	user, err := userRepo.FindByEmail(r.Context(), email)
	if err != nil || user == nil {
		handler.GetLogger().Error("failed to resolve created test-login user", map[string]any{
			"error": err,
			"email": handler.MaskEmail(email),
		})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to resolve local user")
		return nil, false
	}
	return user, true
}
