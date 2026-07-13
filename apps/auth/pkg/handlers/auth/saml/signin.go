package saml

import (
	"context"
	"encoding/base64"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/workos/workos-go/v6/pkg/sso"
)

var (
	readStateRandom   = stateutil.ReadRandom
	buildStatePayload = stateutil.BuildStatePayload
)

type SigninHandlerStruct struct {
	WorkOS     providers.WorkOSProvider
	GetOrg     func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error)
	GetQueries func(ctx context.Context) (*db.Queries, error)
}

func (h *SigninHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("WORKOS_API_KEY"))
	clientID := strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID"))
	if apiKey == "" || clientID == "" {
		handler.JSONError(w, http.StatusInternalServerError, "WorkOS not configured")
		return
	}

	h.WorkOS.Configure(apiKey, clientID)

	email := strings.TrimSpace(r.URL.Query().Get("email"))
	if email == "" {
		handler.JSONError(w, http.StatusBadRequest, "Email is required")
		return
	}

	if !handler.IsValidEmail(email) {
		handler.JSONError(w, http.StatusBadRequest, "Invalid email format")
		return
	}
	_, rawDomain, _ := strings.Cut(email, "@")
	domain := strings.ToLower(strings.TrimSpace(rawDomain))

	q, ok := handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		return
	}
	org, err := h.GetOrg(r.Context(), q, domain)
	if err != nil {
		if handler.HandleNotFound(w, err, "Enterprise SSO is not enabled for this domain") {
			return
		}
		handler.GetLogger().Error("Failed to resolve org for SAML signin", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusInternalServerError, "Server error")
		return
	}
	if org == nil || org.WorkosOrganizationID == nil || *org.WorkosOrganizationID == "" {
		handler.JSONError(w, http.StatusBadRequest, "Enterprise SSO is not enabled for this domain")
		return
	}

	authURL := strings.TrimSpace(os.Getenv("AUTH_SERVICE_URL"))
	if authURL == "" {
		authURL = "https://auth.taskforceai.chat"
	}

	stateBytes := make([]byte, 32)
	if _, err := readStateRandom(stateBytes); err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to initiate SSO")
		return
	}

	nonce := base64.URLEncoding.EncodeToString(stateBytes)
	stateParam, cookieState, err := buildStatePayload(nonce, "", strings.TrimSpace(os.Getenv("AUTH_SECRET")))
	if err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to initiate SSO")
		return
	}

	http.SetCookie(w, &http.Cookie{ //nolint:gosec // SAML state cookie is HttpOnly, SameSite=None, and Secure for provider redirects.
		Name:     "oauth_state",
		Value:    cookieState,
		Path:     "/",
		Expires:  time.Now().Add(10 * time.Minute),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		Domain:   auth.GetCookieDomain(),
	})

	// Request authorization URL from WorkOS
	url, err := h.WorkOS.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{
		Domain:       domain,
		RedirectURI:  authURL + "/api/v1/auth/saml/callback",
		Organization: *org.WorkosOrganizationID,
		State:        stateParam,
	})
	if err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to initiate SSO")
		return
	}

	http.Redirect(w, r, url, http.StatusFound)
}

var signinWorkOSFactory = func(apiKey, clientID string) providers.WorkOSProvider {
	return providers.NewWorkOSClient(apiKey, clientID)
}

// SigninHandler initiates the WorkOS SSO flow.
func SigninHandler(w http.ResponseWriter, r *http.Request) {
	client := signinWorkOSFactory(
		strings.TrimSpace(os.Getenv("WORKOS_API_KEY")),
		strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID")),
	)
	h := &SigninHandlerStruct{
		WorkOS: client,
		GetOrg: func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error) {
			if q == nil {
				return nil, os.ErrInvalid
			}
			org, err := q.GetOrganizationByDomain(ctx, &domain)
			if err != nil {
				return nil, err
			}
			return &org, nil
		},
		GetQueries: nil,
	}
	h.ServeHTTP(w, r)
}
