package publicshare

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockPublicShareQueries struct {
	convFunc     func(ctx context.Context, shareID *string) (SharedConversation, error)
	messagesFunc func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error)
}

func (m *mockPublicShareQueries) GetConversationByShareID(ctx context.Context, shareID *string) (SharedConversation, error) {
	return m.convFunc(ctx, shareID)
}

func (m *mockPublicShareQueries) GetPublicMessagesByConversationID(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
	return m.messagesFunc(ctx, input)
}

var testPublicSharedAt = time.Date(2026, 2, 1, 11, 0, 0, 0, time.UTC)

func testPublicConversation(title string) SharedConversation {
	return SharedConversation{
		ID:                11,
		UserInput:         title,
		IsPublic:          true,
		PublicSharedAt:    testPublicSharedAt,
		HasPublicSharedAt: true,
	}
}

func setupPublicShareRouter(q ConversationQueries) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, q)
	return r
}

func TestPublicShare_Success(t *testing.T) {
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Hello"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			assert.Equal(t, int32(11), input.ConversationID)
			assert.Equal(t, testPublicSharedAt, input.PublicSharedAt)
			return []PublicMessageRow{{
				MessageID:     "msg_1",
				Role:          "assistant",
				Content:       "public content",
				IsAgentStatus: false,
				CreatedAt:     time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC),
				HasCreatedAt:  true,
			}}, nil
		},
	}

	router := setupPublicShareRouter(q)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/public-share/abc")

	var body PublicConversationResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.Equal(t, "Hello", body.Title)
	require.Len(t, body.Messages, 1)
	assert.Equal(t, "msg_1", body.Messages[0].MessageID)
	assert.Equal(t, "assistant", body.Messages[0].Role)
	assert.Equal(t, "public content", body.Messages[0].Content)
	assert.Equal(t, "2026-02-01T12:00:00Z", body.Messages[0].CreatedAt)
}

func TestPublicShare_TrimsOversizedMessages(t *testing.T) {
	originalBudget := publicSharePayloadBudgetBytes
	publicSharePayloadBudgetBytes = 180
	t.Cleanup(func() { publicSharePayloadBudgetBytes = originalBudget })

	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Hello"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return []PublicMessageRow{
				{MessageID: "msg_1", Role: "assistant", Content: "small"},
				{MessageID: "msg_2", Role: "assistant", Content: strings.Repeat("x", 140)},
			}, nil
		},
	}

	router := setupPublicShareRouter(q)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/public-share/abc")
	var body PublicConversationResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.True(t, body.Truncated)
	require.Len(t, body.Messages, 1)
	assert.Equal(t, "msg_1", body.Messages[0].MessageID)
}

func TestPublicShare_Returns413WhenEnvelopeCannotFitBudget(t *testing.T) {
	originalBudget := publicSharePayloadBudgetBytes
	publicSharePayloadBudgetBytes = 1
	t.Cleanup(func() { publicSharePayloadBudgetBytes = originalBudget })

	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Hello"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return []PublicMessageRow{{MessageID: "msg_1", Role: "assistant", Content: "small"}}, nil
		},
	}

	router := setupPublicShareRouter(q)
	handlertest.ServeStatus(t, router, http.StatusRequestEntityTooLarge, http.MethodGet, "/api/v1/public-share/abc")
}

func TestPublicShare_NotFound(t *testing.T) {
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return SharedConversation{}, pgx.ErrNoRows
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return nil, nil
		},
	}

	router := setupPublicShareRouter(q)
	handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/v1/public-share/abc")
}

func TestPublicShare_HidesPrivateAndDeletedConversations(t *testing.T) {
	tests := []struct {
		name string
		conv SharedConversation
	}{
		{name: "private", conv: SharedConversation{ID: 11, UserInput: "Hello", IsPublic: false}},
		{name: "deleted", conv: SharedConversation{ID: 11, UserInput: "Hello", IsPublic: true, IsDeleted: true}},
		{name: "missing snapshot cutoff", conv: SharedConversation{ID: 11, UserInput: "Hello", IsPublic: true}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &mockPublicShareQueries{
				convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
					return tt.conv, nil
				},
				messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
					t.Fatal("messages should not load for hidden shares")
					return nil, nil
				},
			}

			router := setupPublicShareRouter(q)
			handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/v1/public-share/abc")
		})
	}
}

func TestPublicShare_ConversationLoadError(t *testing.T) {
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return SharedConversation{}, errors.New("db unavailable")
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return nil, nil
		},
	}

	router := setupPublicShareRouter(q)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/public-share/abc")
}

func TestPublicShare_MessageLoadError(t *testing.T) {
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Hello"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return nil, errors.New("fail")
		},
	}

	router := setupPublicShareRouter(q)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/public-share/abc")
}

func TestPublicShare_TrimGenericError(t *testing.T) {
	originalTrim := trimPublicMessagesForBudget
	trimPublicMessagesForBudget = func(messages []PublicMessage, title string, budgetBytes int) ([]PublicMessage, bool, int, error) {
		return nil, false, 0, errors.New("trim failed")
	}
	t.Cleanup(func() {
		trimPublicMessagesForBudget = originalTrim
	})

	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Hello"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return []PublicMessageRow{{MessageID: "msg_1", Role: "assistant", Content: "small"}}, nil
		},
	}

	router := setupPublicShareRouter(q)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/public-share/abc")
}
