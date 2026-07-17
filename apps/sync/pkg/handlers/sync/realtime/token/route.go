package token

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/golang-jwt/jwt/v5"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
)

const (
	SyncTokenExpirationSeconds = 120
	SyncTokenAudience          = "sync-realtime"
	SyncTokenIssuer            = "taskforceai-sync"
)

type QueryResolver func(ctx context.Context) (*db.Queries, error)

var signSyncJWT = func(token *jwt.Token, secret []byte) (string, error) {
	return token.SignedString(secret)
}

// RegisterHandlersWithResolver registers the sync token handlers with lazy dependency resolution.
func RegisterHandlersWithResolver(api huma.API, resolve QueryResolver) {
	huma.Register(api, huma.Operation{
		OperationID: "get-sync-realtime-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/sync/realtime/token",
		Summary:     "Issue a realtime sync token",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		Body *struct {
			OrganizationID *int32 `json:"organizationId,omitempty"`
		}
	}) (*struct{ Body map[string]any }, error) {
		if input.User.Email == "" {
			slog.Warn("Sync realtime token request rejected: missing authenticated user")
			return nil, huma.Error401Unauthorized("Unauthorized")
		}

		var organizationID *int32
		if input.Body != nil {
			organizationID = input.Body.OrganizationID
		}
		slog.Info("Sync realtime token request received", "userId", input.User.ID, "orgId", input.OrgID, "requestedOrgId", organizationID != nil)
		if organizationID != nil {
			q, err := resolve(ctx)
			if err != nil || q == nil {
				slog.Warn("Organization-scoped sync realtime token request rejected: membership store unavailable", "userId", input.User.ID, "requestedOrgId", *organizationID, "error", err)
				return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
			}
			ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
			if err != nil {
				slog.Warn("Organization-scoped sync realtime token request rejected: invalid auth ids", "userId", input.User.ID, "requestedOrgId", *organizationID, "error", err)
				return nil, huma.Error403Forbidden("Forbidden")
			}
			if _, err := q.GetMembership(ctx, db.GetMembershipParams{
				OrganizationID: *organizationID,
				UserID:         ids.UserID32,
			}); err != nil {
				slog.Warn("Organization-scoped sync realtime token request rejected: missing membership", "userId", input.User.ID, "requestedOrgId", *organizationID, "error", err)
				return nil, huma.Error403Forbidden("Forbidden: Not a member of this organization")
			}
		}

		// Generate Token
		secret := os.Getenv("AUTH_SECRET")
		if secret == "" {
			slog.Error("AUTH_SECRET not configured")
			return nil, huma.Error500InternalServerError("Server configuration error")
		}

		claims := jwt.MapClaims{
			"sub": input.User.Email,
			"aud": SyncTokenAudience,
			"iss": SyncTokenIssuer,
			"exp": time.Now().Add(SyncTokenExpirationSeconds * time.Second).Unix(),
		}

		if organizationID != nil {
			claims["org"] = *organizationID
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signedToken, err := signSyncJWT(token, []byte(secret))
		if err != nil {
			slog.Error("Failed to sign sync token", "error", err)
			return nil, huma.Error500InternalServerError("Internal error")
		}
		slog.Info("Sync realtime token issued", "userId", input.User.ID, "orgScoped", organizationID != nil, "expiresIn", SyncTokenExpirationSeconds)

		return &struct{ Body map[string]any }{Body: map[string]any{
			"token":      signedToken,
			"expires_in": SyncTokenExpirationSeconds,
		}}, nil
	})
}
