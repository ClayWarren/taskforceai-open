// Package handler provides the developer keys API handlers.
package developer

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/developer-service/pkg/developer"
	"github.com/TaskForceAI/infrastructure/email/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

type CreateKeyRequest struct {
	Tier *string `json:"tier,omitempty" enum:"STARTER,PRO,ENTERPRISE"`
}

type developerKeyResponse struct {
	ID           int        `json:"keyId"`
	DisplayKey   string     `json:"displayKey"`
	Tier         string     `json:"tier" enum:"STARTER,PRO,ENTERPRISE"`
	RateLimit    int        `json:"rateLimit"`
	MonthlyQuota int        `json:"monthlyQuota"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt"`
	RevokedAt    *time.Time `json:"revokedAt"`
}

func mapDeveloperKeyResponse(key developer.DeveloperApiKeyRecord) developerKeyResponse {
	return developerKeyResponse{
		ID:           key.ID,
		DisplayKey:   key.DisplayKey,
		Tier:         string(key.Tier),
		RateLimit:    key.RateLimit,
		MonthlyQuota: key.MonthlyQuota,
		CreatedAt:    key.CreatedAt,
		LastUsedAt:   key.LastUsedAt,
		RevokedAt:    key.RevokedAt,
	}
}

type RevokeKeyRequest struct {
	KeyID int `json:"keyId"`
}

type developerKeyEmailService interface {
	SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error
	SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error
}

var (
	newDeveloperEmailService = func() developerKeyEmailService { return email.NewResendEmailService() }
	developerEmailSendTTL    = 10 * time.Second
)

func RegisterKeysHandlers(api huma.API, q querySource) {
	huma.Register(api, huma.Operation{
		OperationID: "list-developer-keys",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/keys",
		Summary:     "List developer API keys",
		Tags:        []string{"Developer"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*struct {
		Body struct {
			Keys []developerKeyResponse `json:"keys"`
		}
	}, error) {
		dbQueries, err := getDBQueries(ctx, q)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		repo := developer.NewDeveloperRepositoryFromSource(dbQueries)
		service := developer.NewDeveloperKeysService(repo)

		keys, err := service.ListKeys(ctx, input.User.ID)
		if err != nil {
			slog.Error("Fetch keys failed", "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch keys")
		}
		responseKeys := make([]developerKeyResponse, 0, len(keys))
		for _, key := range keys {
			responseKeys = append(responseKeys, mapDeveloperKeyResponse(key))
		}

		return &struct {
			Body struct {
				Keys []developerKeyResponse `json:"keys"`
			}
		}{Body: struct {
			Keys []developerKeyResponse `json:"keys"`
		}{Keys: responseKeys}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-developer-key",
		Method:      http.MethodPost,
		Path:        "/api/v1/developer/keys",
		Summary:     "Create a new developer API key",
		Tags:        []string{"Developer"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		Body CreateKeyRequest
	}) (*struct {
		Body map[string]any
	}, error) {
		dbQueries, err := getDBQueries(ctx, q)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}
		accountStore := developerAccountStoreFromQueries(dbQueries)

		user := input.User
		repo := developer.NewDeveloperRepositoryFromSource(dbQueries)
		service := developer.NewDeveloperKeysService(repo)

		createInput := developer.CreateKeyInput{
			UserID: user.ID,
		}

		if input.Body.Tier != nil {
			tier := developer.DeveloperApiTier(*input.Body.Tier)
			createInput.Tier = &tier
		}

		account, err := accountStore.GetDeveloperAccount(ctx, user.ID)
		if isUserIDRangeError(err) {
			return nil, huma.Error500InternalServerError("Internal error")
		}
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("Authenticated user missing during key creation", "userId", user.ID)
				return nil, huma.Error401Unauthorized("Unauthorized")
			}
			slog.Error("Failed to fetch user for tier check", "error", err)
			return nil, huma.Error500InternalServerError("Failed to verify user tier")
		}
		if account.APITier != nil {
			createInput.UserTier = account.APITier
		}

		result, err := service.CreateKey(ctx, createInput)
		if err != nil {
			if errors.Is(err, developer.ErrKeyLimitReached) {
				return nil, huma.Error400BadRequest(fmt.Sprintf("Key limit reached (%d)", developer.MaxActiveKeysPerUser))
			}
			if errors.Is(err, developer.ErrInvalidTier) {
				return nil, huma.Error400BadRequest("Invalid tier")
			}
			if errors.Is(err, developer.ErrTierUpgradeDenied) {
				return nil, huma.Error403Forbidden("Requested tier exceeds your subscription tier")
			}
			slog.Error("Create key failed", "error", err)
			return nil, huma.Error500InternalServerError("Failed to create key")
		}

		sendDeveloperKeyCreatedEmail(ctx, user.ID, user.Email, user.FullName, result.DisplayKey)
		slog.Info("Developer API key created", "userId", user.ID, "tier", result.Tier)

		return &struct {
			Body map[string]any
		}{Body: map[string]any{
			"message": "Key created",
			"apiKey":  result.Key,
			"warning": "Save it now.",
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "revoke-developer-key",
		Method:      http.MethodDelete,
		Path:        "/api/v1/developer/keys",
		Summary:     "Revoke a developer API key",
		Tags:        []string{"Developer"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		Body RevokeKeyRequest
	}) (*struct {
		Body map[string]string
	}, error) {
		dbQueries, err := getDBQueries(ctx, q)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		user := input.User
		if input.Body.KeyID <= 0 {
			return nil, huma.Error400BadRequest("Key ID required")
		}

		repo := developer.NewDeveloperRepositoryFromSource(dbQueries)
		service := developer.NewDeveloperKeysService(repo)

		result, err := service.RevokeKey(ctx, user.ID, input.Body.KeyID)
		if err != nil {
			if errors.Is(err, developer.ErrKeyNotFound) {
				return nil, huma.Error404NotFound("Key not found")
			}
			if errors.Is(err, developer.ErrKeyAlreadyRevoked) {
				return nil, huma.Error400BadRequest("Key already revoked")
			}
			slog.Error("Revoke key failed", "error", err)
			return nil, huma.Error500InternalServerError("Failed to revoke key")
		}

		sendDeveloperKeyRevokedEmail(ctx, user.ID, user.Email, user.FullName, result.DisplayKey)
		slog.Info("Developer API key revoked", "userId", user.ID, "keyId", input.Body.KeyID)

		return &struct {
			Body map[string]string
		}{Body: map[string]string{"message": "Key revoked"}}, nil
	})
}

func sendDeveloperKeyCreatedEmail(ctx context.Context, userID int, userEmail string, fullName *string, displayKey string) {
	if os.Getenv("RESEND_API_KEY") == "" {
		return
	}
	emailCtx := context.WithoutCancel(ctx)
	adapterhandler.Go("developerKeyCreatedEmail", func() {
		sendCtx, cancel := context.WithTimeout(emailCtx, developerEmailSendTTL)
		defer cancel()
		if err := newDeveloperEmailService().SendApiKeyCreatedEmail(sendCtx, userEmail, developerEmailName(userEmail, fullName), "New Key", displayKey); err != nil {
			slog.Warn("Failed to send API key created email", "userId", userID, "error", err)
		}
	})
}

func sendDeveloperKeyRevokedEmail(ctx context.Context, userID int, userEmail string, fullName *string, displayKey string) {
	if os.Getenv("RESEND_API_KEY") == "" {
		return
	}
	emailCtx := context.WithoutCancel(ctx)
	adapterhandler.Go("developerKeyRevokedEmail", func() {
		sendCtx, cancel := context.WithTimeout(emailCtx, developerEmailSendTTL)
		defer cancel()
		if err := newDeveloperEmailService().SendApiKeyRevokedEmail(sendCtx, userEmail, developerEmailName(userEmail, fullName), displayKey); err != nil {
			slog.Warn("Failed to send API key revoked email", "userId", userID, "error", err)
		}
	})
}

func developerEmailName(userEmail string, fullName *string) string {
	if fullName != nil {
		return *fullName
	}
	return userEmail
}
