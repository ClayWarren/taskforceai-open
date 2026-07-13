package mobile

import (
	"context"
	"errors"
	"fmt"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	"net/http"
	"os"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"golang.org/x/oauth2"
	"google.golang.org/api/idtoken"
)

type GoogleAuthRequest struct {
	IDToken     string `json:"idToken" validate:"required"`
	AccessToken string `json:"accessToken"`
}

type LinkGoogleUserFunc func(ctx context.Context, q *db.Queries, payload *idtoken.Payload) (*auth.AuthUser, error)

type GoogleHandlerStruct struct {
	Google     providers.GoogleProvider
	LinkUser   LinkGoogleUserFunc
	AuditLog   *auth.AuditService
	GetQueries func(ctx context.Context) (*db.Queries, error)
}

var (
	newGoogleClient       = func(config *oauth2.Config) providers.GoogleProvider { return providers.NewGoogleClient(config) }
	defaultGoogleQueries  = appdatabase.GetQueries
	defaultLinkGoogleUser = linkOrCreateGoogleUser
)

func (h *GoogleHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	auditLog := h.AuditLog

	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req GoogleAuthRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return
	}
	req.IDToken = strings.TrimSpace(req.IDToken)
	if req.IDToken == "" {
		handler.JSONError(w, http.StatusBadRequest, "idToken is required")
		return
	}

	var audiences []string
	if webID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")); webID != "" {
		audiences = append(audiences, webID)
	}
	if iosID := strings.TrimSpace(os.Getenv("GOOGLE_IOS_CLIENT_ID")); iosID != "" {
		audiences = append(audiences, iosID)
	}
	if androidID := strings.TrimSpace(os.Getenv("GOOGLE_ANDROID_CLIENT_ID")); androidID != "" {
		audiences = append(audiences, androidID)
	}

	if len(audiences) == 0 {
		handler.GetLogger().Error("Google auth configuration missing (no client IDs found)", map[string]any{
			"hasGoogleClientID": false,
		})
		handler.JSONError(w, http.StatusInternalServerError, "Google auth not configured")
		return
	}

	googleClient := h.Google
	if googleClient == nil {
		googleClient = newGoogleClient(nil)
	}

	var payload *idtoken.Payload
	var err error

	// Try each configured audience until one works or we run out
	for _, aud := range audiences {
		payload, err = googleClient.ValidateIDToken(r.Context(), req.IDToken, aud)
		if err == nil {
			break
		}
	}

	if err != nil {
		handler.GetLogger().Warn("Google ID token verification failed for all audiences", map[string]any{
			"error":     err.Error(),
			"audiences": len(audiences),
		})
		logLoginFailure(r, nil, "Invalid token", auditLog)
		handler.JSONError(w, http.StatusUnauthorized, "Invalid token")
		return
	}

	getQueries := h.GetQueries
	if getQueries == nil {
		getQueries = defaultGoogleQueries
	}
	q, auditLog, ok := requireMobileAuthQueries(w, r, getQueries, auditLog)
	if !ok {
		return
	}

	linkUser := h.LinkUser
	if linkUser == nil {
		linkUser = defaultLinkGoogleUser
	}

	user, err := linkUser(r.Context(), q, payload)
	if err != nil {
		handleOAuthLinkError(w, r, err, auditLog, "Google", "Email missing from Google profile")
		return
	}

	writeMobileSessionResponse(w, r, user, auditLog, "Google")
}

func GoogleHandler(w http.ResponseWriter, r *http.Request) {
	h := &GoogleHandlerStruct{
		Google:     providers.NewGoogleClient(nil),
		LinkUser:   linkOrCreateGoogleUser,
		AuditLog:   nil,
		GetQueries: appdatabase.GetQueries,
	}
	h.ServeHTTP(w, r)
}

func linkOrCreateGoogleUser(ctx context.Context, q *db.Queries, payload *idtoken.Payload) (*auth.AuthUser, error) {
	if payload == nil {
		return nil, errors.New("payload is required")
	}

	email, err := verifiedGoogleEmail(payload.Claims)
	if err != nil {
		return nil, err
	}

	fullName := ""
	if rawName, ok := payload.Claims["name"]; ok {
		if fullNameString, ok := rawName.(string); ok {
			fullName = strings.TrimSpace(fullNameString)
		}
	}

	return linkOrCreateOAuthUser(ctx, q, oauthLinkInput{
		Provider:          "google",
		ProviderAccountID: payload.Subject,
		Email:             email,
		FullName:          fullName,
	})
}

func verifiedGoogleEmail(claims map[string]any) (string, error) {
	if !googleEmailVerified(claims) {
		return "", nil
	}
	rawEmail, ok := claims["email"]
	if !ok {
		return "", errOAuthEmailRequired
	}
	emailString, ok := rawEmail.(string)
	if !ok {
		return "", errOAuthEmailRequired
	}
	email := strings.TrimSpace(emailString)
	if email == "" {
		return "", errOAuthEmailRequired
	}
	if !handler.IsValidEmail(email) {
		return "", fmt.Errorf("%w: invalid format", errOAuthEmailRequired)
	}
	return email, nil
}

func googleEmailVerified(claims map[string]any) bool {
	raw, ok := claims["email_verified"]
	if !ok {
		return false
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}
