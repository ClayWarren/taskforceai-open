package sync

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockSyncRepository implements SyncRepository for testing
type MockSyncRepository struct {
	mock.Mock
}

func (m *MockSyncRepository) GetLatestSyncVersion(ctx context.Context, userID string) (int32, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(int32)
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetLatestOrgSyncVersion(ctx context.Context, orgID int32) (int32, error) {
	args := m.Called(ctx, orgID)
	val, _ := args.Get(0).(int32)
	return val, args.Error(1)
}

func (m *MockSyncRepository) ProjectExistsInScope(ctx context.Context, projectID int32, userID string, organizationID *int32) (bool, error) {
	args := m.Called(ctx, projectID, userID, organizationID)
	return args.Bool(0), args.Error(1)
}

func (m *MockSyncRepository) GetConversationsAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	args := m.Called(ctx, userID, lastVersion, limit)
	val := testConversationRecords(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetConversationsByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	args := m.Called(ctx, orgID, lastVersion, limit)
	val := testConversationRecords(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetMessagesAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]MessageRecord, error) {
	args := m.Called(ctx, userID, lastVersion, limit)
	val := testMessageRecords(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetMessagesByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]MessageRecord, error) {
	args := m.Called(ctx, orgID, lastVersion, limit)
	val := testMessageRecords(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetConversationVersion(ctx context.Context, id int32, userID *string) (ConversationVersion, error) {
	args := m.Called(ctx, id, userID)
	val := testConversationVersion(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) GetConversationVersionWithOrg(ctx context.Context, id int32, userID *string, orgID int32) (ConversationVersion, error) {
	args := m.Called(ctx, id, userID, orgID)
	val := testConversationVersion(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) GetConversation(ctx context.Context, id int32) (ConversationRecord, error) {
	args := m.Called(ctx, id)
	val := testConversationRecord(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) GetConversationWithOrg(ctx context.Context, id int32, orgID int32) (ConversationRecord, error) {
	args := m.Called(ctx, id, orgID)
	val := testConversationRecord(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) UpdateConversationSync(ctx context.Context, params UpdateConversationInput) error {
	args := m.Called(ctx, params)
	return args.Error(0)
}

func (m *MockSyncRepository) CreateConversationSync(ctx context.Context, params CreateConversationInput) (ConversationRecord, error) {
	args := m.Called(ctx, params)
	val := testConversationRecord(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetMessageVersion(ctx context.Context, messageID string) (MessageVersion, error) {
	args := m.Called(ctx, messageID)
	val := testMessageVersion(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) GetMessageVersionScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageVersion, error) {
	return m.GetMessageVersion(ctx, messageID)
}

func (m *MockSyncRepository) GetMessageByMessageID(ctx context.Context, messageID string) (MessageRecord, error) {
	args := m.Called(ctx, messageID)
	val := testMessageRecord(args.Get(0))
	return val, repositoryError(args.Error(1))
}

func (m *MockSyncRepository) GetMessageByMessageIDScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageRecord, error) {
	return m.GetMessageByMessageID(ctx, messageID)
}

func (m *MockSyncRepository) UpdateMessageSync(ctx context.Context, params UpdateMessageInput) error {
	args := m.Called(ctx, params)
	return args.Error(0)
}

func (m *MockSyncRepository) CreateMessageSync(ctx context.Context, params CreateMessageInput) (MessageRecord, error) {
	args := m.Called(ctx, params)
	val := testMessageRecord(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) NextSyncVersion(ctx context.Context, after int32) (int32, error) {
	for _, call := range m.ExpectedCalls {
		if call.Method == "NextSyncVersion" {
			args := m.Called(ctx, after)
			value, _ := args.Get(0).(int32)
			return value, args.Error(1)
		}
	}
	return after + 1, nil
}

func (m *MockSyncRepository) AdvanceSyncVersionSequence(ctx context.Context, minVersion int32) error {
	for _, call := range m.ExpectedCalls {
		if call.Method == "AdvanceSyncVersionSequence" {
			args := m.Called(ctx, minVersion)
			return args.Error(0)
		}
	}
	return nil
}

func (m *MockSyncRepository) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return fn(m)
}

func (m *MockSyncRepository) CreateSyncAuditLog(ctx context.Context, params SyncAuditInput) (SyncAuditRecord, error) {
	args := m.Called(ctx, params)
	val, _ := args.Get(0).(SyncAuditRecord)
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetConversationsCount(ctx context.Context, userID string) (int64, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(int64)
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetMessagesCount(ctx context.Context, userID string) (int64, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(int64)
	return val, args.Error(1)
}

func (m *MockSyncRepository) CountConversationsByOrg(ctx context.Context, orgID int32) (int64, error) {
	args := m.Called(ctx, orgID)
	val, _ := args.Get(0).(int64)
	return val, args.Error(1)
}

func (m *MockSyncRepository) CountMessagesByOrg(ctx context.Context, orgID int32) (int64, error) {
	args := m.Called(ctx, orgID)
	val, _ := args.Get(0).(int64)
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetSyncCounts(ctx context.Context, userID string, orgID *int32) (int64, int64, error) {
	for _, call := range m.ExpectedCalls {
		if call.Method == "GetSyncCounts" {
			args := m.Called(ctx, userID, orgID)
			convCount, _ := args.Get(0).(int64)
			msgCount, _ := args.Get(1).(int64)
			return convCount, msgCount, args.Error(2)
		}
	}
	if orgID != nil {
		convCount, err := m.CountConversationsByOrg(ctx, *orgID)
		if err != nil {
			return 0, 0, err
		}
		msgCount, err := m.CountMessagesByOrg(ctx, *orgID)
		if err != nil {
			return 0, 0, err
		}
		return convCount, msgCount, nil
	}
	convCount, err := m.GetConversationsCount(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	msgCount, err := m.GetMessagesCount(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	return convCount, msgCount, nil
}

func (m *MockSyncRepository) IsSyncDeviceRevoked(ctx context.Context, userID string, deviceID string) (bool, error) {
	for _, call := range m.ExpectedCalls {
		if call.Method == "IsSyncDeviceRevoked" {
			args := m.Called(ctx, userID, deviceID)
			val, _ := args.Get(0).(bool)
			return val, args.Error(1)
		}
	}
	return false, nil
}

func (m *MockSyncRepository) UpsertSyncDevice(ctx context.Context, params UpsertSyncDeviceInput) (SyncDeviceRecord, error) {
	args := m.Called(ctx, params)
	val := testSyncDeviceRecord(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) GetSyncDevices(ctx context.Context, userID string) ([]SyncDeviceRecord, error) {
	args := m.Called(ctx, userID)
	val := testSyncDeviceRecords(args.Get(0))
	return val, args.Error(1)
}

func (m *MockSyncRepository) RevokeSyncDevice(ctx context.Context, userID string, deviceID string) error {
	args := m.Called(ctx, userID, deviceID)
	return args.Error(0)
}

func testConversationRecords(value any) []ConversationRecord {
	switch rows := value.(type) {
	case []ConversationRecord:
		return rows
	case []db.Conversation:
		return mapConversationRecords(rows)
	default:
		return nil
	}
}

func testMessageRecords(value any) []MessageRecord {
	switch rows := value.(type) {
	case []MessageRecord:
		return rows
	case []db.Message:
		result := make([]MessageRecord, 0, len(rows))
		for _, row := range rows {
			result = append(result, mapMessageRecord(row))
		}
		return result
	default:
		return nil
	}
}

func testConversationVersion(value any) ConversationVersion {
	switch row := value.(type) {
	case ConversationVersion:
		return row
	case db.GetConversationVersionRow:
		return ConversationVersion(row)
	default:
		return ConversationVersion{}
	}
}

func testMessageVersion(value any) MessageVersion {
	switch row := value.(type) {
	case MessageVersion:
		return row
	case db.GetMessageVersionRow:
		return MessageVersion(row)
	case db.GetMessageVersionScopedRow:
		return MessageVersion(row)
	default:
		return MessageVersion{}
	}
}

func testConversationRecord(value any) ConversationRecord {
	switch row := value.(type) {
	case ConversationRecord:
		return row
	case db.Conversation:
		return mapConversationRecord(row)
	default:
		return ConversationRecord{}
	}
}

func testMessageRecord(value any) MessageRecord {
	switch row := value.(type) {
	case MessageRecord:
		return row
	case db.Message:
		return mapMessageRecord(row)
	default:
		return MessageRecord{}
	}
}

func testSyncDeviceRecord(value any) SyncDeviceRecord {
	switch row := value.(type) {
	case SyncDeviceRecord:
		return row
	case db.SyncDevice:
		return mapSyncDeviceRecord(row)
	default:
		return SyncDeviceRecord{}
	}
}

func testSyncDeviceRecords(value any) []SyncDeviceRecord {
	switch rows := value.(type) {
	case []SyncDeviceRecord:
		return rows
	case []db.SyncDevice:
		result := make([]SyncDeviceRecord, 0, len(rows))
		for _, row := range rows {
			result = append(result, mapSyncDeviceRecord(row))
		}
		return result
	default:
		return nil
	}
}

// MockBroadcaster for testing
type MockBroadcaster struct {
	mock.Mock
}

func (m *MockBroadcaster) BroadcastSyncRequired(ctx context.Context, userID string, orgID *int32, version int32) error {
	args := m.Called(ctx, userID, orgID, version)
	return args.Error(0)
}

// MockConflictResolver for testing
type MockConflictResolver struct {
	mock.Mock
}

func (m *MockConflictResolver) ResolveConversation(server, incoming ConversationSyncPayload) (ConversationSyncPayload, error) {
	args := m.Called(server, incoming)
	val, _ := args.Get(0).(ConversationSyncPayload)
	return val, args.Error(1)
}

func (m *MockConflictResolver) ResolveMessage(server, incoming MessageSyncPayload) (MessageSyncPayload, error) {
	args := m.Called(server, incoming)
	val, _ := args.Get(0).(MessageSyncPayload)
	return val, args.Error(1)
}

// MockLocker for testing
type MockLocker struct {
	mock.Mock
}

func (m *MockLocker) Lock(ctx context.Context, userID string) (func(), error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(func())
	return val, args.Error(1)
}

// MockIdempotencyStore for testing
type MockIdempotencyStore struct {
	mock.Mock
}

func (m *MockIdempotencyStore) GetResult(ctx context.Context, userID, key string) (IdempotencyLookup, error) {
	args := m.Called(ctx, userID, key)
	val, _ := args.Get(0).(IdempotencyLookup)
	return val, args.Error(1)
}

func (m *MockIdempotencyStore) SaveResult(ctx context.Context, userID, key string, result SyncPushResponse) error {
	args := m.Called(ctx, userID, key, result)
	return args.Error(0)
}

func TestService_PullChanges_WithHash(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(5), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(10), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})

	require.NoError(t, err)
	assert.Equal(t, "5:10", result.StateHash)
	mockRepo.AssertExpectations(t)
}

func TestService_PullChanges_SucceedsWhenAuditAndHashFail(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, errors.New("device table unavailable")).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(0), errors.New("count failed")).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, errors.New("audit failed")).Once()

	result, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Empty(t, result.StateHash)
	mockRepo.AssertExpectations(t)
}

func TestService_PullChanges_ReturnsBeforeAuditCompletes(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	svc := NewService(mockRepo, nil, nil, nil, nil, nil)
	var asyncWG sync.WaitGroup
	svc.runAsync = func(fn func()) {
		asyncWG.Add(1)
		go func() {
			defer asyncWG.Done()
			fn()
		}()
	}
	ctx := context.Background()

	mockRepo.On("IsSyncDeviceRevoked", mock.Anything, "user-1", "device-1").Return(false, nil).Once()
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Maybe()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(0), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(0), nil).Once()

	auditStarted := make(chan struct{})
	releaseAudit := make(chan struct{})
	auditDone := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(releaseAudit) })
	})

	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).
		Run(func(mock.Arguments) {
			close(auditStarted)
			<-releaseAudit
			close(auditDone)
		}).
		Return(db.SyncAuditLog{}, nil).
		Once()

	resultCh := make(chan struct {
		resp *SyncPullResponse
		err  error
	}, 1)
	go func() {
		resp, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})
		resultCh <- struct {
			resp *SyncPullResponse
			err  error
		}{resp: resp, err: err}
	}()

	select {
	case <-auditStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async audit insert to start")
	}

	select {
	case result := <-resultCh:
		require.NoError(t, result.err)
		require.NotNil(t, result.resp)
	case <-time.After(time.Second):
		t.Fatal("PullChanges blocked on audit insert")
	}

	releaseOnce.Do(func() { close(releaseAudit) })
	select {
	case <-auditDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async audit insert to finish")
	}
	asyncWG.Wait()
	mockRepo.AssertExpectations(t)
}

func TestService_DispatchAsyncRejectsWhenWorkerSlotsAreFull(t *testing.T) {
	svc := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)
	svc.asyncSlots = make(chan struct{}, 1)

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	require.True(t, svc.dispatchAsync(func() {
		close(started)
		<-release
		close(done)
	}))

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async worker to start")
	}

	ran := false
	require.False(t, svc.dispatchAsync(func() { ran = true }))
	require.False(t, ran)

	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async worker to finish")
	}
}

func TestService_PullChanges_ReturnsBeforeHeartbeatCompletes(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	svc := NewService(mockRepo, nil, nil, nil, nil, nil)
	var asyncWG sync.WaitGroup
	svc.runAsync = func(fn func()) {
		asyncWG.Add(1)
		go func() {
			defer asyncWG.Done()
			fn()
		}()
	}
	ctx := context.Background()

	mockRepo.On("IsSyncDeviceRevoked", mock.Anything, "user-1", "device-1").Return(false, nil).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
	mockRepo.On("GetSyncCounts", mock.Anything, "user-1", (*int32)(nil)).Return(int64(0), int64(0), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	heartbeatStarted := make(chan struct{})
	releaseHeartbeat := make(chan struct{})
	heartbeatDone := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(releaseHeartbeat) })
	})

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).
		Run(func(mock.Arguments) {
			close(heartbeatStarted)
			<-releaseHeartbeat
			close(heartbeatDone)
		}).
		Return(db.SyncDevice{}, nil).
		Once()

	resultCh := make(chan error, 1)
	go func() {
		_, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})
		resultCh <- err
	}()

	select {
	case err := <-resultCh:
		require.NoError(t, err)
	case <-heartbeatStarted:
		select {
		case err := <-resultCh:
			require.NoError(t, err)
		case <-time.After(100 * time.Millisecond):
			t.Fatal("PullChanges blocked on heartbeat upsert")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for PullChanges or heartbeat upsert")
	}

	releaseOnce.Do(func() { close(releaseHeartbeat) })
	select {
	case <-heartbeatDone:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for async heartbeat upsert to finish")
	}
	asyncWG.Wait()
	mockRepo.AssertExpectations(t)
}

func TestService_PullChanges_RevokedDeviceDenied(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("IsSyncDeviceRevoked", mock.Anything, "user-1", "device-1").Return(true, nil).Once()

	_, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})
	require.ErrorIs(t, err, ErrDeviceRevoked)
	mockRepo.AssertExpectations(t)
}

func TestService_PushChanges_WithIdempotency(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
	ctx := context.Background()

	userID := "user-1"
	idemKey := "request-123"
	cachedResp := SyncPushResponse{Success: true, Version: 42}

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockIdem.On("GetResult", ctx, userID, idemKey).Return(IdempotencyHit{Response: cachedResp}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "device-1", "agent-1", idemKey, SyncPushRequest{})

	require.NoError(t, err)
	assert.Equal(t, int32(42), result.Version)
	mockIdem.AssertExpectations(t)
}

func TestService_PushChanges_DerivesIdempotencyKeyForLegacyClients(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
	ctx := context.Background()
	req := SyncPushRequest{
		Messages:           []MessageSyncPayload{{MessageID: "msg-1", Content: "hello"}},
		ResolutionStrategy: StrategyAutoMerge,
	}
	derivedKey, keyErr := syncPushIdempotencyKey("user-1", "device-1", "", req)
	require.NoError(t, keyErr)

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockIdem.On("GetResult", ctx, "user-1", derivedKey).Return(IdempotencyHit{Response: SyncPushResponse{Success: true, Version: 42}}, nil).Once()

	result, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", req)

	require.NoError(t, err)
	assert.Equal(t, int32(42), result.Version)
	mockRepo.AssertExpectations(t)
	mockIdem.AssertExpectations(t)
}

func TestService_PushChanges_RevokedDeviceDenied(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
	ctx := context.Background()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{
		UserID:    "user-1",
		DeviceID:  "device-1",
		IsRevoked: true,
	}, nil).Once()

	_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "request-123", SyncPushRequest{})
	require.ErrorIs(t, err, ErrDeviceRevoked)
	mockIdem.AssertNotCalled(t, "GetResult", mock.Anything, mock.Anything, mock.Anything)
	mockRepo.AssertExpectations(t)
}

func TestService_PushChanges_WithDistributedLock(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockLocker := new(MockLocker)
	svc := NewService(mockRepo, nil, nil, mockLocker, nil, nil)
	ctx := context.Background()

	userID := "user-1"
	releaseCalled := false
	release := func() { releaseCalled = true }

	mockLocker.On("Lock", ctx, userID).Return(release, nil).Once()
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestSyncVersion", ctx, userID).Return(int32(10), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	_, err := svc.PushChanges(ctx, userID, "device-1", "agent-1", "", SyncPushRequest{})

	require.NoError(t, err)
	assert.True(t, releaseCalled)
	mockLocker.AssertExpectations(t)
}

func TestService_PushChanges_SucceedsWhenIdempotencySaveFails(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
	ctx := context.Background()

	userID := "user-1"
	idemKey := "request-123"

	mockIdem.On("GetResult", ctx, userID, idemKey).Return(IdempotencyMiss{}, nil).Once()
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestSyncVersion", ctx, userID).Return(int32(10), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{{DeviceID: "device-1"}}, nil).Once()
	mockIdem.On("SaveResult", ctx, userID, idemKey, mock.Anything).Return(errors.New("redis unavailable")).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "device-1", "agent-1", idemKey, SyncPushRequest{})

	require.NoError(t, err)
	assert.Equal(t, int32(10), result.Version)
	mockRepo.AssertExpectations(t)
	mockIdem.AssertExpectations(t)
}
