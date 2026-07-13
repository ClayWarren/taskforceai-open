package callback

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
)

type GoogleDriveCallbackHandlerStruct struct {
	Google         providers.GoogleProvider
	AuthUserGetter func(r *http.Request) *adapterauth.AuthenticatedUser
	GetQueries     func(ctx context.Context) (*db.Queries, error)
}

func (h *GoogleDriveCallbackHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	callbackRequest, ok := prepareConnectedOAuthCallbackRequest(w, r, h.AuthUserGetter)
	if !ok {
		return
	}
	user := callbackRequest.user

	token, err := h.Google.Exchange(r.Context(), callbackRequest.code)
	if err != nil {
		slog.Error("Google Drive token exchange failed", "error", err)
		handler.JSONError(w, http.StatusInternalServerError, "Failed to exchange token")
		return
	}
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		slog.Error("Google Drive token exchange returned empty token")
		handler.JSONError(w, http.StatusBadGateway, "Invalid OAuth token response")
		return
	}

	googleUser, err := h.Google.GetUserInfo(r.Context(), token)
	if err != nil {
		slog.Error("Google Drive user info retrieval failed", "error", err)
		handler.JSONError(w, http.StatusBadGateway, "Failed to get Google user info")
		return
	}
	if googleUser == nil || strings.TrimSpace(googleUser.ID) == "" {
		slog.Error("Google Drive user info response missing required identifier")
		handler.JSONError(w, http.StatusBadGateway, "Invalid Google user response")
		return
	}

	providerAccountID := strings.TrimSpace(googleUser.ID)
	scope := ""
	if s, ok := token.Extra("scope").(string); ok {
		scope = s
	}

	q, ok := handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		return
	}

	if err := replaceOAuthAccount(
		r.Context(),
		q,
		user.ID,
		auth.CreateAccountInput{
			UserID:            user.ID,
			Type:              "oauth",
			Provider:          "google-drive",
			ProviderAccountID: providerAccountID,
			RefreshToken:      &token.RefreshToken,
			AccessToken:       &token.AccessToken,
			TokenType:         &token.TokenType,
			Scope:             &scope,
		},
	); err != nil {
		if errors.Is(err, errOAuthAccountDatabaseConnection) {
			handler.JSONError(w, http.StatusInternalServerError, "Database connection failed")
			return
		}
		handler.GetLogger().Error("Google Drive transaction failed", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to update account")
		return
	}

	// Redirect back to profile
	http.Redirect(w, r, "/dashboard?modal=profile&tab=apps", http.StatusTemporaryRedirect)
}

func GoogleDriveCallbackHandler(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET"))
	redirectURL := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_REDIRECT_URL"))

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		slog.Error("Google Drive OAuth configuration missing", "hasClientID", clientID != "", "hasClientSecret", clientSecret != "", "hasRedirectURL", redirectURL != "")
		handler.JSONError(w, http.StatusInternalServerError, "Google OAuth not configured")
		return
	}

	config := providers.DefaultGoogleDriveOAuthConfig(clientID, clientSecret, redirectURL)
	client := providers.NewGoogleClient(config)
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         client,
		AuthUserGetter: handler.GetAuthenticatedUser,
		GetQueries:     nil,
	}
	h.ServeHTTP(w, r)
}
