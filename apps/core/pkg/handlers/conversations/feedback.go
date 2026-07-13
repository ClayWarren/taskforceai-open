package conversations

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
)

type FeedbackRequest struct {
	Rating int `json:"rating" minimum:"-1" maximum:"1" doc:"Rating for the message (-1, 0, or 1)"`
}

type FeedbackQueries interface {
	UpdateMessageRating(ctx context.Context, arg UpdateMessageRatingInput) (int64, error)
}

type UpdateMessageRatingInput struct {
	MessageID      string
	Rating         int32
	UserID         *string
	OrganizationID int32
}

func RegisterFeedbackHandler(api huma.API, q FeedbackQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "message-feedback",
		Method:      http.MethodPost,
		Path:        "/api/v1/messages/{id}/feedback",
		Summary:     "Submit feedback for a message",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		ID   string `path:"id" doc:"Message ID"`
		Body FeedbackRequest
		handler.AuthContext
	}) (*struct{}, error) {
		userID := strconv.Itoa(input.User.ID)
		// #nosec G115
		orgID := int32(input.OrgID)

		updatedRows, err := q.UpdateMessageRating(ctx, UpdateMessageRatingInput{
			MessageID: input.ID,
			// #nosec G115
			Rating:         int32(input.Body.Rating),
			UserID:         &userID,
			OrganizationID: orgID,
		})
		if err != nil {
			slog.Error("Failed to update message rating", "messageId", input.ID, "userId", userID, "rating", input.Body.Rating, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update rating")
		}
		if updatedRows == 0 {
			return nil, huma.Error403Forbidden("Forbidden")
		}

		return &struct{}{}, nil
	})
}
