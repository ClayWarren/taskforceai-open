package conversations

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/core/pkg/conversations"
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
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations?limit=50&offset=0", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportConversationLatencyProfile(b, samples)
}

func reportConversationLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(conversationPercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(conversationPercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(conversationPercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func conversationPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}
