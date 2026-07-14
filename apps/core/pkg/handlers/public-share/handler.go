package publicshare

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// ConversationQueries defines the minimal DB operations needed by public share handlers.
type ConversationQueries interface {
	GetConversationByShareID(ctx context.Context, shareID *string) (SharedConversation, error)
	GetPublicMessagesByConversationID(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error)
}

type SharedConversation struct {
	ID                int32
	UserInput         string
	IsPublic          bool
	IsDeleted         bool
	PublicSharedAt    time.Time
	HasPublicSharedAt bool
}

type PublicMessagesInput struct {
	ConversationID int32
	PublicSharedAt time.Time
}

type PublicMessageRow struct {
	MessageID     string
	Role          string
	Content       string
	IsAgentStatus bool
	CreatedAt     time.Time
	HasCreatedAt  bool
}

var publicSharePayloadBudgetBytes = server.VercelFunctionSafeJSONPayloadBytes

var trimPublicMessagesForBudget = func(messages []PublicMessage, title string, budgetBytes int) ([]PublicMessage, bool, int, error) {
	return server.TrimSliceForJSONBudget(messages, func(items []PublicMessage) any {
		return PublicConversationResponse{Title: title, Messages: items, Truncated: true}
	}, budgetBytes)
}

// RegisterHandlers registers the public share handlers.
func RegisterHandlers(api huma.API, q ConversationQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "get-public-share",
		Method:      http.MethodGet,
		Path:        "/api/v1/public-share/{id}",
		Summary:     "Get public shared conversation",
		Tags:        []string{"Public"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Share ID"`
	}) (*struct{ Body *PublicConversationResponse }, error) {
		conv, err := q.GetConversationByShareID(ctx, &input.ID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound("Shared conversation not found")
			}
			slog.Error("Failed to load public shared conversation", "shareId", input.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to load shared conversation")
		}
		if !conv.IsPublic || conv.IsDeleted || !conv.HasPublicSharedAt {
			return nil, huma.Error404NotFound("Shared conversation not found")
		}

		messageRows, err := q.GetPublicMessagesByConversationID(ctx, PublicMessagesInput{
			ConversationID: conv.ID,
			PublicSharedAt: conv.PublicSharedAt,
		})
		if err != nil {
			slog.Error("Failed to load messages for public share", "conversationId", conv.ID, "shareId", input.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to load messages")
		}

		messages := make([]PublicMessage, 0, len(messageRows))
		for _, msg := range messageRows {
			createdAt := ""
			if msg.HasCreatedAt {
				createdAt = msg.CreatedAt.UTC().Format(time.RFC3339)
			}
			messages = append(messages, PublicMessage{
				MessageID:     msg.MessageID,
				Role:          msg.Role,
				Content:       msg.Content,
				IsAgentStatus: msg.IsAgentStatus,
				CreatedAt:     createdAt,
			})
		}

		responseTitle := conv.UserInput
		messages, truncated, _, err := trimPublicMessagesForBudget(messages, responseTitle, publicSharePayloadBudgetBytes)
		if err != nil {
			slog.Error("Failed to fit public share response within payload budget", "conversationId", conv.ID, "shareId", input.ID, "error", err)
			if errors.Is(err, server.ErrPayloadBudgetExceeded) {
				return nil, server.PayloadTooLargeError("Shared conversation is too large")
			}
			return nil, huma.Error500InternalServerError("Failed to prepare shared conversation")
		}

		return &struct{ Body *PublicConversationResponse }{Body: &PublicConversationResponse{
			Title:     responseTitle,
			Messages:  messages,
			Truncated: truncated,
		}}, nil
	})
}
