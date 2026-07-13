package publicshare

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/go-core/internal/benchmarktest"
)

func BenchmarkPublicShareLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	messages := []PublicMessageRow{
		{MessageID: "msg-1", Role: "user", Content: "hello", CreatedAt: time.Unix(1_700_000_000, 0).UTC(), HasCreatedAt: true},
		{MessageID: "msg-2", Role: "assistant", Content: "world", CreatedAt: time.Unix(1_700_000_001, 0).UTC(), HasCreatedAt: true},
	}
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Shared prompt"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return messages, nil
		},
	}
	router := setupPublicShareRouter(q)
	benchmarktest.ProfileHTTP(b, router, func() *http.Request {
		return httptest.NewRequest(http.MethodGet, "/api/v1/public-share/share-benchmark", nil)
	})
}
