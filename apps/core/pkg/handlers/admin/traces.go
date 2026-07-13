package admin

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/danielgtaylor/huma/v2"
)

type TracesListResponse struct {
	Messages  []TraceMessage `json:"messages"`
	Truncated bool           `json:"truncated,omitempty"`
}

type TraceMessage struct {
	ID      int32  `json:"id"`
	Role    string `json:"role"`
	Content string `json:"content"`
	Trace   []byte `json:"trace,omitempty"`
	Rating  int32  `json:"rating"`
}

type TracesQueries interface {
	GetMessagesWithTraces(ctx context.Context, arg GetMessagesWithTracesInput) ([]TraceMessage, error)
}

type GetMessagesWithTracesInput struct {
	Rating int32
	Limit  int32
}

var tracesListPayloadBudgetBytes = server.VercelFunctionSafeJSONPayloadBytes

var trimTraceMessagesForBudget = func(messages []TraceMessage, budgetBytes int) ([]TraceMessage, bool, int, error) {
	return server.TrimSliceForJSONBudget(messages, func(items []TraceMessage) any {
		return TracesListResponse{Messages: items, Truncated: true}
	}, budgetBytes)
}

func RegisterTracesHandler(api huma.API, q TracesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "admin-list-traces",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/traces",
		Summary:     "List messages with orchestration traces",
		Tags:        []string{"Admin"},
		Security:    []map[string][]string{{"admin": {}}},
	}, func(ctx context.Context, input *struct {
		MinRating int `query:"min_rating" default:"1"`
		Limit     int `query:"limit" default:"50" minimum:"1" maximum:"200"`
		handler.AdminAuthContext
	}) (*struct{ Body TracesListResponse }, error) {
		messages, err := q.GetMessagesWithTraces(ctx, GetMessagesWithTracesInput{
			// #nosec G115
			Rating: int32(input.MinRating),
			// #nosec G115
			Limit: int32(input.Limit),
		})
		if err != nil {
			slog.Error("Failed to fetch orchestration traces for admin", "userId", input.User.ID, "minRating", input.MinRating, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch traces")
		}

		messages, truncated, _, err := trimTraceMessagesForBudget(messages, tracesListPayloadBudgetBytes)
		if err != nil {
			slog.Error("Failed to fit admin traces response within payload budget", "userId", input.User.ID, "minRating", input.MinRating, "error", err)
			if errors.Is(err, server.ErrPayloadBudgetExceeded) {
				return nil, server.PayloadTooLargeError("Trace response is too large")
			}
			return nil, huma.Error500InternalServerError("Failed to prepare traces")
		}

		return &struct{ Body TracesListResponse }{Body: TracesListResponse{
			Messages:  messages,
			Truncated: truncated,
		}}, nil
	})
}
