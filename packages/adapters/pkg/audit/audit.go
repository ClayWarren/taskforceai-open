// Package audit provides audit logging for compliance (SOC2/GDPR).
package audit

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auditflush"
	"github.com/TaskForceAI/adapters/pkg/requestmeta"
)

const (
	bufferMax       = 100
	flushIntervalMs = 2000
)

// AuditAction enumerates audit event types
type AuditAction string

const (
	ActionLogin             AuditAction = "LOGIN"
	ActionLogout            AuditAction = "LOGOUT"
	ActionCreate            AuditAction = "CREATE"
	ActionRead              AuditAction = "READ"
	ActionUpdate            AuditAction = "UPDATE"
	ActionDelete            AuditAction = "DELETE"
	ActionExportData        AuditAction = "EXPORT_DATA"
	ActionDeleteAccount     AuditAction = "DELETE_ACCOUNT"
	ActionAPIKeyCreate      AuditAction = "API_KEY_CREATE" // #nosec G101
	ActionAPIKeyRevoke      AuditAction = "API_KEY_REVOKE" // #nosec G101
	ActionAPICall           AuditAction = "API_CALL"
	ActionAdminAction       AuditAction = "ADMIN_ACTION"
	ActionRateLimitExceeded AuditAction = "RATE_LIMIT_EXCEEDED"
)

// AuditResource enumerates auditable resources
type AuditResource string

const (
	ResourceUser         AuditResource = "user"
	ResourceConversation AuditResource = "conversation"
	ResourceMessage      AuditResource = "message"
	ResourceAPIKey       AuditResource = "api_key"
	ResourceSubscription AuditResource = "subscription"
	ResourceRateLimit    AuditResource = "rate_limit"
	ResourceProject      AuditResource = "project"
	ResourceMembership   AuditResource = "membership"
)

// AuditLogRecord represents a stored audit entry
type AuditLogRecord struct {
	ID             int
	Timestamp      time.Time
	UserID         *string
	OrganizationID *int32
	Action         string
	Resource       string
	ResourceID     *string
	IPAddress      *string
	UserAgent      *string
	Details        any
	Success        bool
	ErrorMessage   *string
}

// AuditLogWrite represents data for creating an audit entry
type AuditLogWrite struct {
	Action         string
	Resource       string
	Details        any
	Success        bool
	UserID         *string
	OrganizationID *int32
	ResourceID     *string
	IPAddress      *string
	UserAgent      *string
	ErrorMessage   *string
}

// AuditLogRepository defines the storage interface for audit logs
type AuditLogRepository interface {
	CreateMany(ctx context.Context, data []AuditLogWrite) error
	Create(ctx context.Context, data AuditLogWrite) error
	FindByUser(ctx context.Context, userID string, take int) ([]AuditLogRecord, error)
	FindByOrganization(ctx context.Context, orgID int32, take int) ([]AuditLogRecord, error)
	FindByResource(ctx context.Context, resource, resourceID string, take int) ([]AuditLogRecord, error)
	FindFailedLoginAttempts(ctx context.Context, hours, take int) ([]AuditLogRecord, error)
	FindForPeriod(ctx context.Context, startDate, endDate time.Time, actions []string) ([]AuditLogRecord, error)
}

// AuditLogEntry is the input for creating an audit log
type AuditLogEntry struct {
	UserID         *string
	OrganizationID *int32
	Action         AuditAction
	Resource       string
	ResourceID     *string
	IPAddress      *string
	UserAgent      *string
	Details        map[string]any
	Success        bool
	ErrorMessage   *string
}

// auditBuffer batches audit writes for efficiency
type auditBuffer struct {
	mu     sync.Mutex
	buffer []AuditLogWrite
	repo   AuditLogRepository
	timer  *time.Timer
	ctx    context.Context
}

func newAuditBuffer(repo AuditLogRepository) *auditBuffer {
	return &auditBuffer{
		buffer: make([]AuditLogWrite, 0, bufferMax),
		repo:   repo,
		ctx:    context.Background(),
	}
}

func (b *auditBuffer) push(data AuditLogWrite) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.buffer = append(b.buffer, data)

	if len(b.buffer) >= bufferMax {
		if b.timer != nil {
			b.timer.Stop()
			b.timer = nil
		}
		b.flushLocked()
		return
	}

	b.scheduleFlushLocked()
}

func (b *auditBuffer) Flush() {
	b.mu.Lock()
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	b.flushLocked()
	b.mu.Unlock()
}

func (b *auditBuffer) scheduleFlushLocked() {
	if b.timer != nil {
		return
	}
	b.timer = time.AfterFunc(flushIntervalMs*time.Millisecond, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.timer = nil
		b.flushLocked()
	})
}

func (b *auditBuffer) flushLocked() {
	if len(b.buffer) == 0 {
		return
	}

	batch := make([]AuditLogWrite, len(b.buffer))
	copy(batch, b.buffer)
	b.buffer = b.buffer[:0]

	if err := b.createMany(batch); err != nil {
		slog.Error("Audit flush failed", "error", err, "size", len(batch))
		b.buffer = append(batch, b.buffer...)
		b.scheduleFlushLocked()
	}
}

func (b *auditBuffer) createMany(batch []AuditLogWrite) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("audit repository panicked: %v", recovered)
		}
	}()
	return b.repo.CreateMany(b.ctx, batch)
}

func (b *auditBuffer) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buffer = b.buffer[:0]
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
}

// AuditLogger provides audit logging functionality
type AuditLogger struct {
	buffer          *auditBuffer
	repo            AuditLogRepository
	unregisterFlush func()
}

var (
	globalLogger *AuditLogger
	loggerOnce   sync.Once
)

// NewAuditLogger creates a new audit logger
func NewAuditLogger(repo AuditLogRepository) *AuditLogger {
	l := &AuditLogger{
		buffer: newAuditBuffer(repo),
		repo:   repo,
	}
	l.unregisterFlush = auditflush.Register(l.Flush)
	loggerOnce.Do(func() {
		globalLogger = l
	})
	return l
}

// GetLogger returns the global audit logger
func GetLogger() *AuditLogger {
	return globalLogger
}

// CreateAuditLog records an audit entry
func (l *AuditLogger) CreateAuditLog(entry AuditLogEntry) {
	success := entry.Success
	data := AuditLogWrite{
		Action:         string(entry.Action),
		Resource:       entry.Resource,
		Details:        entry.Details,
		Success:        success,
		UserID:         entry.UserID,
		OrganizationID: entry.OrganizationID,
		ResourceID:     entry.ResourceID,
		IPAddress:      entry.IPAddress,
		UserAgent:      entry.UserAgent,
		ErrorMessage:   entry.ErrorMessage,
	}

	l.buffer.push(data)

	if !success {
		slog.Warn("Audit failure",
			"action", data.Action,
			"resource", data.Resource,
			"userId", data.UserID,
			"error", data.ErrorMessage,
		)
	}
}

// GetUserAuditLogs retrieves audit logs for a user
func (l *AuditLogger) GetUserAuditLogs(ctx context.Context, userID string, take int) ([]AuditLogRecord, error) {
	if take == 0 {
		take = 100
	}
	return l.repo.FindByUser(ctx, userID, take)
}

// GetOrganizationAuditLogs retrieves audit logs for an organization
func (l *AuditLogger) GetOrganizationAuditLogs(ctx context.Context, orgID int32, take int) ([]AuditLogRecord, error) {
	if take == 0 {
		take = 100
	}
	return l.repo.FindByOrganization(ctx, orgID, take)
}

// GetResourceAuditLogs retrieves audit logs for a resource
func (l *AuditLogger) GetResourceAuditLogs(ctx context.Context, resource, resourceID string, take int) ([]AuditLogRecord, error) {
	if take == 0 {
		take = 50
	}
	return l.repo.FindByResource(ctx, resource, resourceID, take)
}

// GetFailedLoginAttempts retrieves recent failed login attempts
func (l *AuditLogger) GetFailedLoginAttempts(ctx context.Context, hours, take int) ([]AuditLogRecord, error) {
	if hours == 0 {
		hours = 24
	}
	if take == 0 {
		take = 100
	}
	return l.repo.FindFailedLoginAttempts(ctx, hours, take)
}

// GetAuditLogsForPeriod retrieves audit logs within a time range
func (l *AuditLogger) GetAuditLogsForPeriod(ctx context.Context, startDate, endDate time.Time, actions []AuditAction) ([]AuditLogRecord, error) {
	actionStrs := make([]string, 0, len(actions))
	for _, a := range actions {
		actionStrs = append(actionStrs, string(a))
	}
	return l.repo.FindForPeriod(ctx, startDate, endDate, actionStrs)
}

// Flush forces a flush of buffered entries
func (l *AuditLogger) Flush() {
	l.buffer.Flush()
}

// Reset clears the buffer (for testing)
func (l *AuditLogger) Reset() {
	if l.unregisterFlush != nil {
		l.unregisterFlush()
		l.unregisterFlush = nil
	}
	l.buffer.Reset()
}

// GetClientIP extracts client IP from request headers.
// Only trusts forwarded headers if they come from a known proxy.
func GetClientIP(r *http.Request) *string {
	return requestmeta.GetClientIP(r)
}

// GetUserAgent extracts user agent from request
func GetUserAgent(r *http.Request) *string {
	return requestmeta.GetUserAgent(r)
}
