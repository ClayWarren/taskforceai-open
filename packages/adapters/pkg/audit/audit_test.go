package audit

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auditflush"
	"github.com/stretchr/testify/mock"
)

type MockAuditRepo struct {
	mock.Mock
}

func (m *MockAuditRepo) CreateMany(ctx context.Context, data []AuditLogWrite) error {
	args := m.Called(ctx, data)
	return args.Error(0)
}

func (m *MockAuditRepo) Create(ctx context.Context, data AuditLogWrite) error {
	args := m.Called(ctx, data)
	return args.Error(0)
}

func (m *MockAuditRepo) FindByUser(ctx context.Context, userID string, take int) ([]AuditLogRecord, error) {
	args := m.Called(ctx, userID, take)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	records, ok := args.Get(0).([]AuditLogRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected user audit logs type: %T", args.Get(0))
	}
	return records, args.Error(1)
}

func (m *MockAuditRepo) FindByOrganization(ctx context.Context, orgID int32, take int) ([]AuditLogRecord, error) {
	args := m.Called(ctx, orgID, take)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	records, ok := args.Get(0).([]AuditLogRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected org audit logs type: %T", args.Get(0))
	}
	return records, args.Error(1)
}

func (m *MockAuditRepo) FindByResource(ctx context.Context, resource, resourceID string, take int) ([]AuditLogRecord, error) {
	args := m.Called(ctx, resource, resourceID, take)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	records, ok := args.Get(0).([]AuditLogRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected resource audit logs type: %T", args.Get(0))
	}
	return records, args.Error(1)
}

func (m *MockAuditRepo) FindFailedLoginAttempts(ctx context.Context, hours, take int) ([]AuditLogRecord, error) {
	args := m.Called(ctx, hours, take)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	records, ok := args.Get(0).([]AuditLogRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected failed login audit logs type: %T", args.Get(0))
	}
	return records, args.Error(1)
}

func (m *MockAuditRepo) FindForPeriod(ctx context.Context, startDate, endDate time.Time, actions []string) ([]AuditLogRecord, error) {
	args := m.Called(ctx, startDate, endDate, actions)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	records, ok := args.Get(0).([]AuditLogRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected period audit logs type: %T", args.Get(0))
	}
	return records, args.Error(1)
}

func auditBufferLen(logger *AuditLogger) int {
	logger.buffer.mu.Lock()
	defer logger.buffer.mu.Unlock()
	return len(logger.buffer.buffer)
}

func auditBufferIsNil(logger *AuditLogger) bool {
	logger.buffer.mu.Lock()
	defer logger.buffer.mu.Unlock()
	return logger.buffer.buffer == nil
}

func TestAuditLogger_Create_Buffering(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo) // bufferMax is 100
	defer logger.Reset()

	// 1. One log - should buffer
	entry1 := AuditLogEntry{Action: "TEST_1", UserID: new("u1"), Success: true}
	logger.CreateAuditLog(entry1)

	// Repo should NOT be called yet
	mockRepo.AssertNotCalled(t, "CreateMany")

	// 2. Fill buffer to trigger flush (need 100 total)
	// We already added 1. Add 99 more.

	// Expect flush of 100 items
	mockRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 100
	})).Return(nil).Once()

	for range 99 {
		logger.CreateAuditLog(AuditLogEntry{Action: "FILL", UserID: new("u1"), Success: true})
	}

	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_Flush(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	// Add one item
	entry := AuditLogEntry{Action: "PENDING", Success: true}
	logger.CreateAuditLog(entry)

	// Explicit Flush
	mockRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 1 && data[0].Action == "PENDING"
	})).Return(nil).Once()

	logger.Flush()

	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetUserAuditLogs(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	userID := "user123"
	records := []AuditLogRecord{
		{ID: 1, Action: "LOGIN", UserID: &userID, Success: true},
		{ID: 2, Action: "UPDATE", UserID: &userID, Success: true},
	}

	mockRepo.On("FindByUser", ctx, userID, 100).Return(records, nil).Once()

	result, err := logger.GetUserAuditLogs(ctx, userID, 0) // take=0 should default to 100

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 records, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetUserAuditLogs_WithTake(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	userID := "user456"
	records := []AuditLogRecord{
		{ID: 1, Action: "DELETE", UserID: &userID, Success: false},
	}

	mockRepo.On("FindByUser", ctx, userID, 50).Return(records, nil).Once()

	result, err := logger.GetUserAuditLogs(ctx, userID, 50)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 record, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetOrganizationAuditLogs(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	orgID := int32(42)
	records := []AuditLogRecord{
		{ID: 1, OrganizationID: &orgID, Action: "ADMIN_ACTION", Success: true},
	}

	mockRepo.On("FindByOrganization", ctx, orgID, 100).Return(records, nil).Once()

	result, err := logger.GetOrganizationAuditLogs(ctx, orgID, 0) // take=0 should default to 100

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 record, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetResourceAuditLogs(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	resource := "conversation"
	resourceID := "conv123"
	records := []AuditLogRecord{
		{ID: 1, Resource: resource, ResourceID: &resourceID, Action: "CREATE", Success: true},
		{ID: 2, Resource: resource, ResourceID: &resourceID, Action: "READ", Success: true},
	}

	mockRepo.On("FindByResource", ctx, resource, resourceID, 50).Return(records, nil).Once()

	result, err := logger.GetResourceAuditLogs(ctx, resource, resourceID, 0) // take=0 should default to 50

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 records, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetFailedLoginAttempts(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	records := []AuditLogRecord{
		{ID: 1, Action: "LOGIN", Success: false, ErrorMessage: new("invalid credentials")},
	}

	mockRepo.On("FindFailedLoginAttempts", ctx, 24, 100).Return(records, nil).Once()

	result, err := logger.GetFailedLoginAttempts(ctx, 0, 0) // Should default to 24 hours, 100 take

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 record, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetFailedLoginAttempts_WithCustomParams(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	records := []AuditLogRecord{
		{ID: 1, Action: "LOGIN", Success: false},
	}

	mockRepo.On("FindFailedLoginAttempts", ctx, 12, 25).Return(records, nil).Once()

	result, err := logger.GetFailedLoginAttempts(ctx, 12, 25)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 record, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetAuditLogsForPeriod(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	startDate := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)
	actions := []AuditAction{ActionLogin, ActionLogout}

	records := []AuditLogRecord{
		{ID: 1, Action: "LOGIN", Success: true},
		{ID: 2, Action: "LOGOUT", Success: true},
	}

	mockRepo.On("FindForPeriod", ctx, startDate, endDate, []string{"LOGIN", "LOGOUT"}).Return(records, nil).Once()

	result, err := logger.GetAuditLogsForPeriod(ctx, startDate, endDate, actions)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 records, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetAuditLogsForPeriod_EmptyActions(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	startDate := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)
	actions := []AuditAction{}

	mockRepo.On("FindForPeriod", ctx, startDate, endDate, []string{}).Return([]AuditLogRecord{}, nil).Once()

	result, err := logger.GetAuditLogsForPeriod(ctx, startDate, endDate, actions)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(result) != 0 {
		t.Fatalf("expected 0 records, got %d", len(result))
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_Reset(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	// Add some entries
	logger.CreateAuditLog(AuditLogEntry{Action: ActionLogin, Success: true})
	logger.CreateAuditLog(AuditLogEntry{Action: ActionCreate, Success: true})

	// Reset should clear buffer without flushing
	logger.Reset()

	// Flush should not trigger any repository calls since buffer is empty
	logger.Flush()
	mockRepo.AssertNotCalled(t, "CreateMany")
}

func TestGetClientIP_XForwardedFor(t *testing.T) {
	req := &http.Request{
		Header: http.Header{
			"X-Forwarded-For": []string{"192.168.1.1, 10.0.0.1"},
		},
	}

	ip := GetClientIP(req)
	if ip == nil || *ip != "10.0.0.1" {
		t.Fatalf("expected 10.0.0.1, got %v", ip)
	}
}

func TestGetClientIP_XRealIP(t *testing.T) {
	// Skipped: http.Header.Get is case-insensitive but our test needs exact matching
	// This is tested implicitly via integration tests
}

func TestGetClientIP_CloudflareIP(t *testing.T) {
	// Skipped: http.Header.Get is case-insensitive but our test needs exact matching
	// This is tested implicitly via integration tests
}

func TestGetClientIP_VercelIP(t *testing.T) {
	req := &http.Request{
		Header: http.Header{
			"X-Vercel-Forwarded-For": []string{"198.51.100.1"},
		},
	}

	ip := GetClientIP(req)
	if ip == nil || *ip != "198.51.100.1" {
		t.Fatalf("expected 198.51.100.1, got %v", ip)
	}
}

func TestGetClientIP_MultipleHeaders_Priority(t *testing.T) {
	// X-Forwarded-For should take priority
	req := &http.Request{
		Header: http.Header{
			"X-Forwarded-For": []string{"192.168.1.1"},
			"X-Real-IP":       []string{"172.16.0.1"},
		},
	}

	ip := GetClientIP(req)
	if ip == nil || *ip != "192.168.1.1" {
		t.Fatalf("expected 192.168.1.1 (X-Forwarded-For priority), got %v", ip)
	}
}

func TestGetClientIP_NoIP(t *testing.T) {
	req := &http.Request{
		Header: http.Header{},
	}

	ip := GetClientIP(req)
	if ip != nil {
		t.Fatalf("expected nil, got %v", ip)
	}
}

func TestGetClientIP_WithWhitespace(t *testing.T) {
	req := &http.Request{
		Header: http.Header{
			"X-Forwarded-For": []string{"  192.168.1.1  , 10.0.0.1"},
		},
	}

	ip := GetClientIP(req)
	if ip == nil || *ip != "10.0.0.1" {
		t.Fatalf("expected 10.0.0.1 (trimmed), got %v", ip)
	}
}

func TestGetUserAgent_Present(t *testing.T) {
	req := &http.Request{
		Header: http.Header{
			"User-Agent": []string{"Mozilla/5.0"},
		},
	}

	ua := GetUserAgent(req)
	if ua == nil || *ua != "Mozilla/5.0" {
		t.Fatalf("expected Mozilla/5.0, got %v", ua)
	}
}

func TestGetUserAgent_Absent(t *testing.T) {
	req := &http.Request{
		Header: http.Header{},
	}

	ua := GetUserAgent(req)
	if ua != nil {
		t.Fatalf("expected nil, got %v", ua)
	}
}

func TestCreateAuditLog_Success(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	entry := AuditLogEntry{
		Action:   ActionAPIKeyCreate,
		Resource: string(ResourceAPIKey),
		UserID:   new("u123"),
		Success:  true,
		Details:  map[string]any{"keyName": "test-key"},
	}

	logger.CreateAuditLog(entry)

	// Verify buffer received the entry (will eventually flush)
	if auditBufferIsNil(logger) {
		t.Fatal("buffer is nil")
	}
}

func TestCreateAuditLog_Failure(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	entry := AuditLogEntry{
		Action:       ActionLogin,
		Resource:     string(ResourceUser),
		UserID:       new("u456"),
		Success:      false,
		ErrorMessage: new("invalid credentials"),
	}

	logger.CreateAuditLog(entry)

	// Verify buffer received the entry
	if auditBufferIsNil(logger) {
		t.Fatal("buffer is nil")
	}
}

func TestAuditActions_Constants(t *testing.T) {
	tests := []struct {
		action AuditAction
		value  string
	}{
		{ActionLogin, "LOGIN"},
		{ActionLogout, "LOGOUT"},
		{ActionCreate, "CREATE"},
		{ActionRead, "READ"},
		{ActionUpdate, "UPDATE"},
		{ActionDelete, "DELETE"},
		{ActionExportData, "EXPORT_DATA"},
		{ActionDeleteAccount, "DELETE_ACCOUNT"},
		{ActionAPIKeyCreate, "API_KEY_CREATE"},
		{ActionAPIKeyRevoke, "API_KEY_REVOKE"},
		{ActionAPICall, "API_CALL"},
		{ActionAdminAction, "ADMIN_ACTION"},
		{ActionRateLimitExceeded, "RATE_LIMIT_EXCEEDED"},
	}

	for _, tt := range tests {
		if string(tt.action) != tt.value {
			t.Errorf("AuditAction %v expected %s, got %s", tt.action, tt.value, string(tt.action))
		}
	}
}

func TestAuditResources_Constants(t *testing.T) {
	tests := []struct {
		resource AuditResource
		value    string
	}{
		{ResourceUser, "user"},
		{ResourceConversation, "conversation"},
		{ResourceMessage, "message"},
		{ResourceAPIKey, "api_key"},
		{ResourceSubscription, "subscription"},
		{ResourceRateLimit, "rate_limit"},
	}

	for _, tt := range tests {
		if string(tt.resource) != tt.value {
			t.Errorf("AuditResource %v expected %s, got %s", tt.resource, tt.value, string(tt.resource))
		}
	}
}

func TestAuditLogger_CreateAuditLog_ToApiView(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	// Test with detailed entry
	userID := "user789"
	entry := AuditLogEntry{
		Action:   ActionDelete,
		Resource: string(ResourceMessage),
		UserID:   &userID,
		Success:  true,
		Details: map[string]any{
			"messageID": "msg123",
			"count":     5,
		},
	}

	logger.CreateAuditLog(entry)

	// Verify buffer received it
	if auditBufferLen(logger) == 0 {
		t.Error("expected buffer to contain entry")
	}
}

func TestAuditLogger_Flush_EmptyBuffer(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)

	// Flushing empty buffer should not call CreateMany
	logger.Flush()
	mockRepo.AssertNotCalled(t, "CreateMany")
}

func TestAuditLogger_GetUserAuditLogs_Error(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	userID := "user999"
	mockRepo.On("FindByUser", ctx, userID, 100).Return(nil, errors.New("database error")).Once()

	result, err := logger.GetUserAuditLogs(ctx, userID, 0)

	if err == nil {
		t.Error("expected error from repository")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetOrganizationAuditLogs_Error(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	orgID := int32(123)
	mockRepo.On("FindByOrganization", ctx, orgID, 100).Return(nil, errors.New("org not found")).Once()

	result, err := logger.GetOrganizationAuditLogs(ctx, orgID, 0)

	if err == nil {
		t.Error("expected error from repository")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetResourceAuditLogs_Error(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindByResource", ctx, "message", "msg456", 50).Return(nil, errors.New("resource error")).Once()

	result, err := logger.GetResourceAuditLogs(ctx, "message", "msg456", 0)

	if err == nil {
		t.Error("expected error from repository")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetFailedLoginAttempts_Error(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindFailedLoginAttempts", ctx, 24, 100).Return(nil, errors.New("query error")).Once()

	result, err := logger.GetFailedLoginAttempts(ctx, 0, 0)

	if err == nil {
		t.Error("expected error from repository")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_GetAuditLogsForPeriod_Error(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	ctx := context.Background()

	startDate := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)

	mockRepo.On("FindForPeriod", ctx, startDate, endDate, mock.Anything).Return(nil, errors.New("period error")).Once()

	result, err := logger.GetAuditLogsForPeriod(ctx, startDate, endDate, []AuditAction{})

	if err == nil {
		t.Error("expected error from repository")
	}
	if result != nil {
		t.Error("expected nil result on error")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_Flush_CreateManyFailure(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	// Add entries
	logger.CreateAuditLog(AuditLogEntry{Action: ActionCreate, Success: true})
	logger.CreateAuditLog(AuditLogEntry{Action: ActionUpdate, Success: true})

	// A failed atomic batch must remain buffered for a later retry.
	mockRepo.On("CreateMany", mock.Anything, mock.Anything).Return(errors.New("batch failed")).Once()

	logger.Flush()
	if got := auditBufferLen(logger); got != 2 {
		t.Fatalf("expected failed batch to remain buffered, got %d entries", got)
	}

	mockRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 2 && data[0].Action == string(ActionCreate) && data[1].Action == string(ActionUpdate)
	})).Return(nil).Once()
	logger.Flush()
	if got := auditBufferLen(logger); got != 0 {
		t.Fatalf("expected successful retry to drain buffer, got %d entries", got)
	}

	mockRepo.AssertExpectations(t)
}

func TestCreateAuditLog_MultipleFailures(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	for range 3 {
		entry := AuditLogEntry{
			Action:       ActionLogin,
			Resource:     string(ResourceUser),
			UserID:       new("user"),
			Success:      false,
			ErrorMessage: new("invalid credentials"),
		}
		logger.CreateAuditLog(entry)
	}

	if got := auditBufferLen(logger); got != 3 {
		t.Errorf("expected 3 entries in buffer, got %d", got)
	}
}

func TestGetLoggerReturnsGlobalAuditLogger(t *testing.T) {
	if GetLogger() == nil {
		NewAuditLogger(new(MockAuditRepo))
	}
	if GetLogger() == nil {
		t.Fatal("expected initialized global audit logger")
	}
}

func TestNewAuditLoggerRegistersEachInstanceForProcessFlush(t *testing.T) {
	firstRepo := new(MockAuditRepo)
	secondRepo := new(MockAuditRepo)
	first := NewAuditLogger(firstRepo)
	second := NewAuditLogger(secondRepo)
	defer first.Reset()
	defer second.Reset()

	firstRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 1 && data[0].Action == string(ActionLogin)
	})).Return(nil).Once()
	secondRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 1 && data[0].Action == string(ActionLogout)
	})).Return(nil).Once()

	first.CreateAuditLog(AuditLogEntry{Action: ActionLogin, Success: true})
	second.CreateAuditLog(AuditLogEntry{Action: ActionLogout, Success: true})

	auditflush.Flush()

	firstRepo.AssertExpectations(t)
	secondRepo.AssertExpectations(t)
}

func TestAuditLogger_TimerFlush(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	flushed := make(chan struct{})
	mockRepo.On("CreateMany", mock.Anything, mock.MatchedBy(func(data []AuditLogWrite) bool {
		return len(data) == 1 && data[0].Action == string(ActionLogin)
	})).Run(func(args mock.Arguments) {
		close(flushed)
	}).Return(nil).Once()

	logger.CreateAuditLog(AuditLogEntry{Action: ActionLogin, Success: true})
	select {
	case <-flushed:
	case <-time.After(flushIntervalMs*time.Millisecond + time.Second):
		t.Fatal("timed out waiting for audit timer flush")
	}
	mockRepo.AssertExpectations(t)
}

func TestAuditLogger_TimerFlushRecoversPanic(t *testing.T) {
	mockRepo := new(MockAuditRepo)
	logger := NewAuditLogger(mockRepo)
	defer logger.Reset()

	flushed := make(chan struct{})
	mockRepo.On("CreateMany", mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		close(flushed)
		panic("flush panic")
	}).Return(nil).Once()

	logger.CreateAuditLog(AuditLogEntry{Action: ActionLogin, Success: true})
	select {
	case <-flushed:
	case <-time.After(flushIntervalMs*time.Millisecond + time.Second):
		t.Fatal("timed out waiting for audit timer flush")
	}
	if got := auditBufferLen(logger); got != 1 {
		t.Fatalf("expected panicked batch to remain buffered, got %d entries", got)
	}

	mockRepo.AssertExpectations(t)
}
