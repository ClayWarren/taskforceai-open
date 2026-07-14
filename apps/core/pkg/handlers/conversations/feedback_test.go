package conversations

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockFeedbackQueries struct {
	updateMessageRatingFunc func(ctx context.Context, arg UpdateMessageRatingInput) (int64, error)
}

func (m *mockFeedbackQueries) UpdateMessageRating(ctx context.Context, arg UpdateMessageRatingInput) (int64, error) {
	return m.updateMessageRatingFunc(ctx, arg)
}

func setupFeedbackRouter(q FeedbackQueries, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterFeedbackHandler(api, q)
	return r
}

func TestFeedbackHandler_SuccessWithOrgAuthorization(t *testing.T) {
	var captured UpdateMessageRatingInput
	q := &mockFeedbackQueries{
		updateMessageRatingFunc: func(ctx context.Context, arg UpdateMessageRatingInput) (int64, error) {
			captured = arg
			return 1, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupFeedbackRouter(q, user, 42)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodPost, "/api/v1/messages/msg-123/feedback", strings.NewReader(`{"rating":1}`))
	assert.Equal(t, "msg-123", captured.MessageID)
	assert.Equal(t, int32(1), captured.Rating)
	require.NotNil(t, captured.UserID)
	assert.Equal(t, "7", *captured.UserID)
	assert.EqualValues(t, 42, captured.OrganizationID)
}

func TestFeedbackHandler_ForbiddenWhenMessageNotOwned(t *testing.T) {
	q := &mockFeedbackQueries{
		updateMessageRatingFunc: func(ctx context.Context, arg UpdateMessageRatingInput) (int64, error) {
			return 0, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupFeedbackRouter(q, user, 0)

	handlertest.ServeStatus(t, router, http.StatusForbidden, http.MethodPost, "/api/v1/messages/msg-123/feedback", strings.NewReader(`{"rating":-1}`))
}

func TestFeedbackHandler_UpdateError(t *testing.T) {
	q := &mockFeedbackQueries{
		updateMessageRatingFunc: func(ctx context.Context, arg UpdateMessageRatingInput) (int64, error) {
			return 0, errors.New("db error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupFeedbackRouter(q, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/messages/msg-123/feedback", strings.NewReader(`{"rating":1}`))
}

func TestFeedbackHandler_InvalidRatingRejected(t *testing.T) {
	q := &mockFeedbackQueries{
		updateMessageRatingFunc: func(ctx context.Context, arg UpdateMessageRatingInput) (int64, error) {
			return 1, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupFeedbackRouter(q, user, 0)

	handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodPost, "/api/v1/messages/msg-123/feedback", strings.NewReader(`{"rating":5}`))
}
