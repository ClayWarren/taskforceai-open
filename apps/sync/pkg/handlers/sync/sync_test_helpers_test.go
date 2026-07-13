package sync

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-sync/pkg/sync"
)

type stubRepo struct {
	latestVersion    int32
	latestOrgVersion int32
	conversations    []sync.ConversationRecord
	messages         []sync.MessageRecord
	convCount        int64
	msgCount         int64
	orgConvCount     int64
	orgMsgCount      int64
	devices          []sync.SyncDeviceRecord
	revokeDeviceErr  error
	latestUserID     string
}

func testUser() *adapterauth.AuthenticatedUser {
	return &adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}
}

func (s *stubRepo) GetLatestSyncVersion(ctx context.Context, userID string) (int32, error) {
	s.latestUserID = userID
	return s.latestVersion, nil
}

func (s *stubRepo) GetLatestOrgSyncVersion(ctx context.Context, orgID int32) (int32, error) {
	return s.latestOrgVersion, nil
}

func (s *stubRepo) AdvanceSyncVersionSequence(ctx context.Context, version int32) error {
	return nil
}

func (s *stubRepo) NextSyncVersion(ctx context.Context, after int32) (int32, error) {
	return after + 1, nil
}

func (s *stubRepo) GetConversationsAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]sync.ConversationRecord, error) {
	return s.conversations, nil
}

func (s *stubRepo) GetConversationsByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]sync.ConversationRecord, error) {
	return s.conversations, nil
}

func (s *stubRepo) GetMessagesAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]sync.MessageRecord, error) {
	return s.messages, nil
}

func (s *stubRepo) GetMessagesByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]sync.MessageRecord, error) {
	return s.messages, nil
}

func (s *stubRepo) GetConversationVersion(ctx context.Context, id int32, userID *string) (sync.ConversationVersion, error) {
	return sync.ConversationVersion{}, nil
}

func (s *stubRepo) GetConversationVersionWithOrg(ctx context.Context, id int32, userID *string, orgID int32) (sync.ConversationVersion, error) {
	return sync.ConversationVersion{}, nil
}

func (s *stubRepo) GetConversation(ctx context.Context, id int32) (sync.ConversationRecord, error) {
	return sync.ConversationRecord{}, nil
}

func (s *stubRepo) GetConversationWithOrg(ctx context.Context, id int32, orgID int32) (sync.ConversationRecord, error) {
	return sync.ConversationRecord{}, nil
}

func (s *stubRepo) UpdateConversationSync(ctx context.Context, params sync.UpdateConversationInput) error {
	return nil
}

func (s *stubRepo) CreateConversationSync(ctx context.Context, params sync.CreateConversationInput) (sync.ConversationRecord, error) {
	return sync.ConversationRecord{}, nil
}

func (s *stubRepo) GetMessageVersion(ctx context.Context, messageID string) (sync.MessageVersion, error) {
	return sync.MessageVersion{}, nil
}

func (s *stubRepo) GetMessageVersionScoped(ctx context.Context, messageID string, userID string, orgID *int32) (sync.MessageVersion, error) {
	return sync.MessageVersion{}, nil
}

func (s *stubRepo) GetMessageByMessageID(ctx context.Context, messageID string) (sync.MessageRecord, error) {
	return sync.MessageRecord{}, nil
}

func (s *stubRepo) GetMessageByMessageIDScoped(ctx context.Context, messageID string, userID string, orgID *int32) (sync.MessageRecord, error) {
	return sync.MessageRecord{}, nil
}

func (s *stubRepo) UpdateMessageSync(ctx context.Context, params sync.UpdateMessageInput) error {
	return nil
}

func (s *stubRepo) CreateMessageSync(ctx context.Context, params sync.CreateMessageInput) (sync.MessageRecord, error) {
	return sync.MessageRecord{}, nil
}

func (s *stubRepo) WithTransaction(ctx context.Context, fn func(sync.SyncRepository) error) error {
	return fn(s)
}

func (s *stubRepo) CreateSyncAuditLog(ctx context.Context, params sync.SyncAuditInput) (sync.SyncAuditRecord, error) {
	return sync.SyncAuditRecord{}, nil
}

func (s *stubRepo) GetConversationsCount(ctx context.Context, userID string) (int64, error) {
	return s.convCount, nil
}

func (s *stubRepo) GetMessagesCount(ctx context.Context, userID string) (int64, error) {
	return s.msgCount, nil
}

func (s *stubRepo) CountConversationsByOrg(ctx context.Context, orgID int32) (int64, error) {
	return s.orgConvCount, nil
}

func (s *stubRepo) CountMessagesByOrg(ctx context.Context, orgID int32) (int64, error) {
	return s.orgMsgCount, nil
}

func (s *stubRepo) GetSyncCounts(ctx context.Context, userID string, orgID *int32) (int64, int64, error) {
	if orgID != nil {
		return s.orgConvCount, s.orgMsgCount, nil
	}
	return s.convCount, s.msgCount, nil
}

func (s *stubRepo) IsSyncDeviceRevoked(ctx context.Context, userID string, deviceID string) (bool, error) {
	return false, nil
}

func (s *stubRepo) UpsertSyncDevice(ctx context.Context, params sync.UpsertSyncDeviceInput) (sync.SyncDeviceRecord, error) {
	return sync.SyncDeviceRecord{}, nil
}

func (s *stubRepo) GetSyncDevices(ctx context.Context, userID string) ([]sync.SyncDeviceRecord, error) {
	return s.devices, nil
}

func (s *stubRepo) RevokeSyncDevice(ctx context.Context, userID string, deviceID string) error {
	return s.revokeDeviceErr
}

func setupAPI(service *sync.Service, repo sync.SyncRepository, user *adapterauth.AuthenticatedUser, q ...*db.Queries) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})

	var queries *db.Queries
	if len(q) > 0 {
		queries = q[0]
	}

	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(context.Context) (Dependencies, error) {
		return Dependencies{
			Service: service,
			Repo:    repo,
			Queries: queries,
		}, nil
	})
	return r
}
