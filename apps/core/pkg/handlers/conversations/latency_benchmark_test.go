package conversations

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/core/pkg/conversations"
	"github.com/TaskForceAI/go-core/internal/benchmarktest"
)

func BenchmarkConversationHandlerLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	page := &conversations.ConversationsPage{
		Conversations: []conversations.ConversationApiView{
			{ID: 1, UserInput: "first prompt"},
			{ID: 2, UserInput: "second prompt"},
			{ID: 3, UserInput: "third prompt"},
		},
		Total:   3,
		Limit:   50,
		Offset:  0,
		HasMore: false,
	}
	service := &mockConversationService{
		listFunc: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			return page, nil
		},
	}
	router := setupConversationRouter(service, &auth.AuthenticatedUser{ID: 3, Email: "benchmark@example.com"}, 21)
	benchmarktest.ProfileHTTP(b, router, func() *http.Request {
		return httptest.NewRequest(http.MethodGet, "/api/v1/conversations?limit=50&offset=0", nil)
	})
}
