package conversations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/TaskForceAI/adapters/pkg/handler"
)

const defaultPublicShareBaseURL = "https://taskforceai.chat"

var shareIDRandRead = rand.Read

// ShareQueries defines DB operations required for conversation sharing.
type ShareQueries interface {
	UpdateConversationSharing(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error)
	UpdateConversationSharingWithOrg(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error)
}

type UpdateConversationSharingInput struct {
	ID       int32
	IsPublic bool
	ShareID  *string
	UserID   *string
}

type UpdateConversationSharingWithOrgInput struct {
	ID             int32
	IsPublic       bool
	ShareID        *string
	UserID         *string
	OrganizationID *int32
}

type SharedConversation struct {
	ID       int32
	IsPublic bool
	ShareID  *string
}

func publicShareBaseURL() string {
	if baseURL := os.Getenv("PUBLIC_APP_URL"); baseURL != "" {
		return baseURL
	}
	if baseURL := os.Getenv("APP_URL"); baseURL != "" {
		return baseURL
	}
	return defaultPublicShareBaseURL
}

func generateShareID() (string, error) {
	buf := make([]byte, 16)
	if _, err := shareIDRandRead(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// RegisterShareHandler registers conversation sharing endpoints.
func RegisterShareHandler(api huma.API, q ShareQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "conversation-share",
		Method:      http.MethodPost,
		Path:        "/api/v1/conversations/{id}/share",
		Summary:     "Enable or disable public sharing for a conversation",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		ID   int32 `path:"id" doc:"Conversation ID"`
		Body struct {
			IsPublic bool `json:"is_public"`
		}
		handler.AuthContext
	}) (*struct {
		Body struct {
			ShareID  string `json:"share_id"`
			IsPublic bool   `json:"is_public"`
			URL      string `json:"url"`
		}
	}, error) {
		userID := strconv.Itoa(input.User.ID)
		var (
			updated SharedConversation
			err     error
		)

		var shareID *string
		if input.Body.IsPublic {
			rawShareID, shareErr := generateShareID()
			if shareErr != nil {
				return nil, huma.Error500InternalServerError("Failed to generate share ID")
			}
			shareID = &rawShareID
		}

		if input.OrgID != 0 {
			orgID, convErr := intToInt32(input.OrgID)
			if convErr != nil {
				return nil, huma.Error400BadRequest("Organization ID is out of bounds")
			}
			updated, err = q.UpdateConversationSharingWithOrg(ctx, UpdateConversationSharingWithOrgInput{
				ID:             input.ID,
				IsPublic:       input.Body.IsPublic,
				ShareID:        shareID,
				UserID:         &userID,
				OrganizationID: &orgID,
			})
		} else {
			updated, err = q.UpdateConversationSharing(ctx, UpdateConversationSharingInput{
				ID:       input.ID,
				IsPublic: input.Body.IsPublic,
				ShareID:  shareID,
				UserID:   &userID,
			})
		}
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound("Conversation not found")
			}
			return nil, huma.Error500InternalServerError("Failed to update conversation sharing")
		}

		shareIDValue := ""
		shareURL := ""
		if updated.ShareID != nil {
			shareIDValue = *updated.ShareID
			shareURL = publicShareBaseURL() + "/share/" + shareIDValue
		}

		return &struct {
			Body struct {
				ShareID  string `json:"share_id"`
				IsPublic bool   `json:"is_public"`
				URL      string `json:"url"`
			}
		}{Body: struct {
			ShareID  string `json:"share_id"`
			IsPublic bool   `json:"is_public"`
			URL      string `json:"url"`
		}{
			ShareID:  shareIDValue,
			IsPublic: updated.IsPublic,
			URL:      shareURL,
		}}, nil
	})
}

// intToInt32 safely converts an int to int32, returning an error if the value
// is outside the int32 range. This avoids #nosec suppressors for G115.
func intToInt32(v int) (int32, error) {
	if v > math.MaxInt32 || v < math.MinInt32 {
		return 0, fmt.Errorf("value %d out of int32 range", v)
	}
	return int32(v), nil
}
