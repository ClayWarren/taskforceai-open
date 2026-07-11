package conversations

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
)

type mockShareQueries struct {
	updateFunc        func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error)
	updateWithOrgFunc func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error)
}

func (m *mockShareQueries) UpdateConversationSharing(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
	return m.updateFunc(ctx, arg)
}

func (m *mockShareQueries) UpdateConversationSharingWithOrg(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
	return m.updateWithOrgFunc(ctx, arg)
}

func setupShareRouter(q ShareQueries, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
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
	RegisterShareHandler(api, q)
	return r
}

func TestRegisterShareHandler_EnablePublicShare(t *testing.T) {
	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			require.NotNil(t, arg.ShareID)
			return SharedConversation{
				ID:       arg.ID,
				IsPublic: true,
				ShareID:  arg.ShareID,
			}, nil
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			return SharedConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, 0)

	resp := serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":true}`))

	var body struct {
		ShareID  string `json:"share_id"`
		IsPublic bool   `json:"is_public"`
		URL      string `json:"url"`
	}
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.True(t, body.IsPublic)
	assert.NotEmpty(t, body.ShareID)
	assert.Equal(t, "https://taskforceai.chat/share/"+body.ShareID, body.URL)
}

func TestRegisterShareHandler_DisablePublicShareWithOrg(t *testing.T) {
	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			return SharedConversation{}, nil
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			assert.Nil(t, arg.ShareID)
			require.NotNil(t, arg.OrganizationID)
			assert.Equal(t, int32(13), *arg.OrganizationID)
			return SharedConversation{
				ID:       arg.ID,
				IsPublic: false,
				ShareID:  nil,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, 13)

	resp := serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":false}`))

	var body struct {
		ShareID  string `json:"share_id"`
		IsPublic bool   `json:"is_public"`
		URL      string `json:"url"`
	}
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.False(t, body.IsPublic)
	assert.Empty(t, body.ShareID)
	assert.Empty(t, body.URL)
}

func TestRegisterShareHandler_ConversationNotFound(t *testing.T) {
	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			return SharedConversation{}, pgx.ErrNoRows
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			return SharedConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, 0)

	serveJSONRequest(t, router, http.StatusNotFound, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":true}`))
}

func TestRegisterShareHandler_UpdateError(t *testing.T) {
	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			return SharedConversation{}, errors.New("db error")
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			return SharedConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, 0)

	serveJSONRequest(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":true}`))
}

func TestRegisterShareHandler_GenerateShareIDError(t *testing.T) {
	originalRandRead := shareIDRandRead
	shareIDRandRead = func(buf []byte) (int, error) {
		return 0, errors.New("random unavailable")
	}
	t.Cleanup(func() {
		shareIDRandRead = originalRandRead
	})

	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			t.Fatal("update should not be called when share ID generation fails")
			return SharedConversation{}, nil
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			t.Fatal("update with org should not be called when share ID generation fails")
			return SharedConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, 0)

	serveJSONRequest(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":true}`))
}

func TestRegisterShareHandler_OrganizationIDOutOfBounds(t *testing.T) {
	q := &mockShareQueries{
		updateFunc: func(ctx context.Context, arg UpdateConversationSharingInput) (SharedConversation, error) {
			return SharedConversation{}, nil
		},
		updateWithOrgFunc: func(ctx context.Context, arg UpdateConversationSharingWithOrgInput) (SharedConversation, error) {
			t.Fatal("update should not be called with an out-of-range organization ID")
			return SharedConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "admin@example.com"}
	router := setupShareRouter(q, user, math.MaxInt32+1)

	serveJSONRequest(t, router, http.StatusBadRequest, http.MethodPost, "/api/v1/conversations/42/share", strings.NewReader(`{"is_public":false}`))
}

func TestPublicShareBaseURL_EnvPriority(t *testing.T) {
	t.Setenv("APP_URL", "https://app.example.com")
	assert.Equal(t, "https://app.example.com", publicShareBaseURL())

	t.Setenv("PUBLIC_APP_URL", "https://public.example.com")
	assert.Equal(t, "https://public.example.com", publicShareBaseURL())
}

func TestIntToInt32_Bounds(t *testing.T) {
	value, err := intToInt32(math.MaxInt32)
	require.NoError(t, err)
	assert.Equal(t, int32(math.MaxInt32), value)

	_, err = intToInt32(math.MaxInt32 + 1)
	require.Error(t, err)

	_, err = intToInt32(math.MinInt32 - 1)
	require.Error(t, err)
}
