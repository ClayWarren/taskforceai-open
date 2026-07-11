// Package dbtest provides shared helpers for tests that mock the database
// layer with pgxmock. It exists to keep test fixtures (such as the canonical
// column ordering for the users table) in a single place, so they cannot drift
// out of sync with the sqlc-generated queries.
package dbtest

import (
	"math/big"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"
)

// Baseline selects which default column values UserValues emits. BaselineDefault
// matches auth/engine tests (dark theme, feature flags on). BaselineBilling
// matches billing handler fixtures (empty theme, flags off, STARTER api tier).
type Baseline int

const (
	BaselineDefault Baseline = iota
	BaselineBilling
)

// NewMockPool returns a pgxmock pool using the default (exact) query matcher.
// The pool is closed automatically via t.Cleanup, and a setup error fails the
// test, so callers can collapse the usual three-line construct
// (NewPool/NoError/defer Close) into a single call.
func NewMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	pool, err := pgxmock.NewPool()
	require.NoError(t, err, "dbtest: create mock pool")
	t.Cleanup(pool.Close)
	return pool
}

// NewMockPoolRegexp behaves like NewMockPool but configures the regexp query
// matcher (pgxmock.QueryMatcherRegexp), as used by tests that match queries
// with regular expressions rather than exact strings.
func NewMockPoolRegexp(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	pool, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err, "dbtest: create mock pool")
	t.Cleanup(pool.Close)
	return pool
}

// UserColumns returns the column names for the users table in the exact order
// produced by the sqlc-generated SELECT/RETURNING queries (see
// packages/adapters/pkg/db/users.sql.go). Tests that build mock rows with
// pgxmock.NewRows must use this ordering so that the row scan matches the
// generated User struct.
//
// A fresh slice is returned on each call so callers may mutate it freely.
func UserColumns() []string {
	return []string{
		"id", "email", "full_name", "disabled", "theme_preference", "memory_enabled",
		"web_search_enabled", "code_execution_enabled", "notifications_enabled", "trust_layer_enabled", "quick_mode_enabled",
		"mfa_enabled", "mfa_totp_secret", "mfa_verified_at", "plan", "message_count", "last_message_timestamp", "is_admin", "subscription_id",
		"subscription_status", "subscription_source", "price_id", "payment_method_brand",
		"payment_method_last4", "current_period_start", "current_period_end", "cancel_at_period_end",
		"stripe_subscription_event_created_at", "customer_id", "revenuecat_app_user_id", "mobile_original_transaction_id", "mobile_product_id",
		"api_subscription_id", "api_subscription_status", "api_tier", "api_requests_used",
		"api_requests_limit", "api_current_period_start", "api_current_period_end", "requests_limit",
		"reset_date", "credit_balance", "auto_recharge_enabled", "auto_recharge_amount", "auto_recharge_threshold",
	}
}

// User specifies the columns of a users-table row that tests commonly vary. The
// zero value yields an enabled, free-plan, non-admin user with memory/web/code/
// notifications enabled (trust layer and quick mode off) and valid timestamps.
// Set only the fields a test cares about; everything else uses these canonical
// defaults. It is the single source of truth for the users fixture so mock rows
// cannot drift from the sqlc-generated User struct (see UserColumns).
type User struct {
	ID       int32
	Email    string
	FullName *string
	Disabled bool
	IsAdmin  bool
	Theme    string // default "dark"
	Plan     string // default "free"

	// Feature flags; nil means the default (memory/web/code/notifications on,
	// trust layer and quick mode off).
	Memory        *bool
	WebSearch     *bool
	CodeExecution *bool
	Notifications *bool
	TrustLayer    *bool
	QuickMode     *bool
	MFAEnabled    bool
	MFATOTPSecret *string
	MFAVerifiedAt any

	// Baseline selects default theme, flags, and timestamps (see Baseline type).
	Baseline Baseline

	// PaymentsStyle, when Baseline is BaselineBilling, matches payments/checkout
	// handler rows (empty plan, valid last_message/reset timestamps).
	PaymentsStyle bool

	// APITier is the api_tier column; nil defaults to db.DeveloperApiTier("free")
	// (BaselineDefault) or db.DeveloperApiTierSTARTER (BaselineBilling).
	APITier          any
	APIRequestsUsed  int32
	APIRequestsLimit int32
	APIPeriodStart   any // api_current_period_start; nil uses baseline defaults
	APIPeriodEnd     any // api_current_period_end

	// Billing populates the subscription/payment/credit columns; nil emits the
	// empty defaults.
	Billing *UserBilling
}

// UserBilling holds the optional billing-related columns of a users row.
type UserBilling struct {
	SubscriptionID              *string
	SubscriptionStatus          *string
	SubscriptionSource          any
	PaymentMethodBrand          *string
	PaymentMethodLast4          *string
	CurrentPeriodStart          any
	CurrentPeriodEnd            any
	StripeSubscriptionEventAt   any
	CustomerID                  *string
	MobileOriginalTransactionID *string
	CreditBalance               pgtype.Numeric
	AutoRechargeEnabled         bool
	AutoRechargeAmount          pgtype.Numeric
	AutoRechargeThreshold       pgtype.Numeric
}

func boolOr(p *bool, def bool) bool {
	if p != nil {
		return *p
	}
	return def
}

// UserValues returns the column values for a single users row in UserColumns()
// order, suitable for spreading into pgxmock's AddRow.
func UserValues(u User) []any {
	if u.Baseline == BaselineBilling {
		return billingUserValues(u)
	}
	return defaultUserValues(u)
}

func defaultUserValues(u User) []any {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	theme := u.Theme
	if theme == "" {
		theme = "dark"
	}
	plan := u.Plan
	if plan == "" {
		plan = "free"
	}
	var apiTier any = db.DeveloperApiTier("free")
	if u.APITier != nil {
		apiTier = u.APITier
	}

	b := u.Billing
	if b == nil {
		b = &UserBilling{}
	}
	periodStart := b.CurrentPeriodStart
	if periodStart == nil {
		periodStart = ts
	}
	periodEnd := b.CurrentPeriodEnd
	if periodEnd == nil {
		periodEnd = ts
	}
	stripeSubscriptionEventAt := b.StripeSubscriptionEventAt
	if stripeSubscriptionEventAt == nil {
		stripeSubscriptionEventAt = pgtype.Timestamp{}
	}
	mfaVerifiedAt := u.MFAVerifiedAt
	if mfaVerifiedAt == nil {
		mfaVerifiedAt = pgtype.Timestamp{}
	}

	return []any{
		u.ID, u.Email, u.FullName, u.Disabled, theme,
		boolOr(u.Memory, true), boolOr(u.WebSearch, true), boolOr(u.CodeExecution, true),
		boolOr(u.Notifications, true), boolOr(u.TrustLayer, false), boolOr(u.QuickMode, false),
		u.MFAEnabled, u.MFATOTPSecret, mfaVerifiedAt,
		plan, int32(0), ts, u.IsAdmin,
		b.SubscriptionID, b.SubscriptionStatus, b.SubscriptionSource, nil, b.PaymentMethodBrand,
		b.PaymentMethodLast4, periodStart, periodEnd, false, stripeSubscriptionEventAt, b.CustomerID,
		nil, b.MobileOriginalTransactionID, nil, nil, nil,
		apiTier, u.APIRequestsUsed, u.APIRequestsLimit, ts, ts,
		nil, ts, b.CreditBalance, b.AutoRechargeEnabled, b.AutoRechargeAmount,
		b.AutoRechargeThreshold,
	}
}

func billingUserValues(u User) []any {
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	invalidTS := pgtype.Timestamp{}
	apiPeriodStart := u.APIPeriodStart
	if apiPeriodStart == nil {
		apiPeriodStart = pgtype.Timestamp{Time: now, Valid: false}
	}
	apiPeriodEnd := u.APIPeriodEnd
	if apiPeriodEnd == nil {
		apiPeriodEnd = pgtype.Timestamp{Time: now, Valid: false}
	}

	theme := u.Theme
	plan := u.Plan
	if !u.PaymentsStyle && plan == "" {
		plan = "free"
	}

	var apiTier any = db.DeveloperApiTierSTARTER
	if u.APITier != nil {
		apiTier = u.APITier
	}

	b := u.Billing
	if b == nil {
		b = &UserBilling{}
	}

	subSource := b.SubscriptionSource
	if subSource == nil {
		subSource = (*db.SubscriptionSource)(nil)
	}

	periodStart := b.CurrentPeriodStart
	if periodStart == nil {
		periodStart = invalidTS
	}
	periodEnd := b.CurrentPeriodEnd
	if periodEnd == nil {
		periodEnd = invalidTS
	}
	stripeSubscriptionEventAt := b.StripeSubscriptionEventAt
	if stripeSubscriptionEventAt == nil {
		stripeSubscriptionEventAt = invalidTS
	}

	lastMessage := invalidTS
	resetDate := invalidTS
	creditBalance := b.CreditBalance
	if u.PaymentsStyle {
		lastMessage = ts
		resetDate = ts
		if !creditBalance.Valid {
			creditBalance = pgtype.Numeric{Int: big.NewInt(0), Valid: true}
		}
	}
	mfaVerifiedAt := u.MFAVerifiedAt
	if mfaVerifiedAt == nil {
		mfaVerifiedAt = invalidTS
	}

	return []any{
		u.ID, u.Email, u.FullName, u.Disabled, theme,
		boolOr(u.Memory, false), boolOr(u.WebSearch, false), boolOr(u.CodeExecution, false),
		boolOr(u.Notifications, false), boolOr(u.TrustLayer, false), boolOr(u.QuickMode, false),
		u.MFAEnabled, u.MFATOTPSecret, mfaVerifiedAt,
		plan, int32(0), lastMessage, u.IsAdmin,
		b.SubscriptionID, b.SubscriptionStatus, subSource, nil, b.PaymentMethodBrand,
		b.PaymentMethodLast4, periodStart, periodEnd, false, stripeSubscriptionEventAt, b.CustomerID,
		nil, b.MobileOriginalTransactionID, nil, nil, nil,
		apiTier, u.APIRequestsUsed, u.APIRequestsLimit, apiPeriodStart, apiPeriodEnd,
		nil, resetDate, creditBalance, b.AutoRechargeEnabled, b.AutoRechargeAmount,
		b.AutoRechargeThreshold,
	}
}

// UserRow returns a *pgxmock.Rows containing a single users row for u.
func UserRow(u User) *pgxmock.Rows {
	return pgxmock.NewRows(UserColumns()).AddRow(UserValues(u)...)
}

// UserRows returns a *pgxmock.Rows containing one row per user.
func UserRows(users ...User) *pgxmock.Rows {
	rows := pgxmock.NewRows(UserColumns())
	for _, u := range users {
		rows.AddRow(UserValues(u)...)
	}
	return rows
}

// DeveloperBillingUser returns a User fixture matching developer handler/repository
// tests (BaselineBilling, PaymentsStyle, STARTER-tier defaults).
func DeveloperBillingUser(id int32, email string, apiRequestsLimit int32) User {
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	return User{
		ID: id, Email: email, Baseline: BaselineBilling, PaymentsStyle: true,
		APIRequestsLimit: apiRequestsLimit,
		APIPeriodStart:   ts,
		APIPeriodEnd:     ts,
	}
}

// APIKeyColumns returns developer_api_keys columns in sqlc SELECT/RETURNING order.
func APIKeyColumns() []string {
	return []string{
		"id", "user_id", "key_hash", "display_key", "name", "tier",
		"rate_limit", "monthly_quota", "created_at", "updated_at",
		"revoked_at", "last_used_at",
	}
}

// APIKey specifies a developer_api_keys row for mock tests.
type APIKey struct {
	ID           int32
	UserID       int32
	KeyHash      string
	DisplayKey   string
	Name         *string
	Tier         any   // db.DeveloperApiTier or string; default STARTER
	RateLimit    int32 // 0 uses HandlerStyle/repository defaults below
	MonthlyQuota int32
	CreatedAt    any
	UpdatedAt    any
	RevokedAt    any
	LastUsedAt   any
	// HandlerStyle uses time.Time created/updated and nil revoked/last_used (HTTP handler tests).
	// When false, repository-style pgtype timestamps apply (updated/revoked/last invalid unless set).
	HandlerStyle bool
}

// APIKeyValues returns column values in APIKeyColumns() order.
func APIKeyValues(k APIKey) []any {
	now := time.Now()
	tier := any(db.DeveloperApiTierSTARTER)
	if k.Tier != nil {
		tier = k.Tier
	}

	rateLimitDefault := int32(100)
	monthlyQuotaDefault := int32(1000)
	if k.HandlerStyle {
		rateLimitDefault = 1000
		monthlyQuotaDefault = 1_000_000
	}
	rateLimit := k.RateLimit
	if rateLimit == 0 {
		rateLimit = rateLimitDefault
	}
	monthlyQuota := k.MonthlyQuota
	if monthlyQuota == 0 {
		monthlyQuota = monthlyQuotaDefault
	}

	created := k.CreatedAt
	if created == nil {
		if k.HandlerStyle {
			created = now
		} else {
			created = pgtype.Timestamp{Time: now, Valid: true}
		}
	}
	updated := k.UpdatedAt
	if updated == nil {
		if k.HandlerStyle {
			updated = now
		} else {
			updated = pgtype.Timestamp{Valid: false}
		}
	}
	revoked := k.RevokedAt
	if revoked == nil && !k.HandlerStyle {
		revoked = pgtype.Timestamp{Valid: false}
	}
	lastUsed := k.LastUsedAt
	if lastUsed == nil && !k.HandlerStyle {
		lastUsed = pgtype.Timestamp{Valid: false}
	}

	return []any{
		k.ID, k.UserID, k.KeyHash, k.DisplayKey, k.Name, tier,
		rateLimit, monthlyQuota, created, updated, revoked, lastUsed,
	}
}

// APIKeyRow returns a single developer_api_keys mock row.
func APIKeyRow(k APIKey) *pgxmock.Rows {
	return pgxmock.NewRows(APIKeyColumns()).AddRow(APIKeyValues(k)...)
}

// APIKeyRows returns one row per API key.
func APIKeyRows(keys ...APIKey) *pgxmock.Rows {
	rows := pgxmock.NewRows(APIKeyColumns())
	for _, k := range keys {
		rows.AddRow(APIKeyValues(k)...)
	}
	return rows
}

// ConversationColumns returns conversations columns in sqlc SELECT/RETURNING order.
func ConversationColumns() []string {
	return []string{
		"id", "timestamp", "user_id", "organization_id", "user_input", "result",
		"execution_time", "model", "agent_count", "project_id", "is_public", "share_id",
		"public_shared_at", "vector_clock", "sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at",
	}
}

// Conversation specifies a conversations row for mock tests.
type Conversation struct {
	ID             int32
	Timestamp      any
	UserID         *string
	OrganizationID *int32
	UserInput      string
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     int32
	ProjectID      *int32
	IsPublic       bool
	ShareID        *string
	PublicSharedAt any
	VectorClock    []byte
	SyncVersion    int32
	LastSyncedAt   any
	DeviceID       *string
	IsDeleted      bool
	UpdatedAt      any
}

// ConversationValues returns column values in ConversationColumns() order.
func ConversationValues(c Conversation) []any {
	now := time.Now()
	ts := c.Timestamp
	if ts == nil {
		ts = pgtype.Timestamp{Time: now, Valid: true}
	}
	userInput := c.UserInput
	if userInput == "" {
		userInput = "input"
	}
	agentCount := c.AgentCount
	if agentCount == 0 {
		agentCount = 1
	}
	vectorClock := c.VectorClock
	if vectorClock == nil {
		vectorClock = []byte("{}")
	}
	lastSynced := c.LastSyncedAt
	if lastSynced == nil {
		lastSynced = ts
	}
	updated := c.UpdatedAt
	if updated == nil {
		updated = ts
	}
	publicSharedAt := c.PublicSharedAt
	if publicSharedAt == nil {
		publicSharedAt = pgtype.Timestamp{}
	}
	return []any{
		c.ID, ts, c.UserID, c.OrganizationID, userInput, c.Result, c.ExecutionTime, c.Model,
		agentCount, c.ProjectID, c.IsPublic, c.ShareID, publicSharedAt, vectorClock, c.SyncVersion,
		lastSynced, c.DeviceID, c.IsDeleted, updated,
	}
}

// ConversationRow returns a single conversations mock row.
func ConversationRow(c Conversation) *pgxmock.Rows {
	return pgxmock.NewRows(ConversationColumns()).AddRow(ConversationValues(c)...)
}

// ConversationRows returns one row per conversation.
func ConversationRows(conversations ...Conversation) *pgxmock.Rows {
	rows := pgxmock.NewRows(ConversationColumns())
	for _, c := range conversations {
		rows.AddRow(ConversationValues(c)...)
	}
	return rows
}

// EngineConversation returns the canonical conversation fixture used by engine
// handler lazy-query tests (fixed Unix timestamps, org/user, prompt/result).
func EngineConversation() Conversation {
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	userID := "user-1"
	orgID := int32(7)
	result := "done"
	executionTime := 1.5
	model := "gpt-5.6-sol"
	return Conversation{
		ID: 1, Timestamp: now, UserID: &userID, OrganizationID: &orgID,
		UserInput: "prompt", Result: &result, ExecutionTime: &executionTime,
		Model: &model, AgentCount: 3, VectorClock: []byte("{}"), SyncVersion: 1,
		LastSyncedAt: now, UpdatedAt: now,
	}
}

// MessageColumns returns messages columns in sqlc SELECT/RETURNING order.
func MessageColumns() []string {
	return []string{
		"id", "message_id", "conversation_id", "role", "content", "is_streaming",
		"is_agent_status", "elapsed_seconds", "created_at", "error",
		"sources", "tool_events", "agent_statuses", "vector_clock", "sync_version",
		"last_synced_at", "device_id", "is_deleted", "updated_at", "rating", "trace",
	}
}

// Message specifies a messages row for mock tests.
type Message struct {
	ID             int32
	MessageID      string
	ConversationID int32
	Role           string
	Content        string
	IsStreaming    bool
	IsAgentStatus  bool
	ElapsedSeconds *float64
	CreatedAt      any
	Error          *string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	VectorClock    []byte
	SyncVersion    int32
	LastSyncedAt   any
	DeviceID       *string
	IsDeleted      bool
	UpdatedAt      any
	Rating         int32
	Trace          []byte
}

// MessageValues returns column values in MessageColumns() order.
func MessageValues(m Message) []any {
	now := time.Now()
	created := m.CreatedAt
	if created == nil {
		created = pgtype.Timestamp{Time: now, Valid: true}
	}
	messageID := m.MessageID
	if messageID == "" {
		messageID = "msg-1"
	}
	role := m.Role
	if role == "" {
		role = "user"
	}
	content := m.Content
	if content == "" {
		content = "hello"
	}
	sources := m.Sources
	if sources == nil {
		sources = []byte("[]")
	}
	toolEvents := m.ToolEvents
	if toolEvents == nil {
		toolEvents = []byte("[]")
	}
	agentStatuses := m.AgentStatuses
	if agentStatuses == nil {
		agentStatuses = []byte("[]")
	}
	vectorClock := m.VectorClock
	if vectorClock == nil {
		vectorClock = []byte("{}")
	}
	lastSynced := m.LastSyncedAt
	if lastSynced == nil {
		lastSynced = created
	}
	updated := m.UpdatedAt
	if updated == nil {
		updated = created
	}
	return []any{
		m.ID, messageID, m.ConversationID, role, content, m.IsStreaming,
		m.IsAgentStatus, m.ElapsedSeconds, created, m.Error,
		sources, toolEvents, agentStatuses, vectorClock, m.SyncVersion,
		lastSynced, m.DeviceID, m.IsDeleted, updated, m.Rating, m.Trace,
	}
}

// MessageRow returns a single messages mock row.
func MessageRow(m Message) *pgxmock.Rows {
	return pgxmock.NewRows(MessageColumns()).AddRow(MessageValues(m)...)
}

// MessageRows returns one row per message.
func MessageRows(messages ...Message) *pgxmock.Rows {
	rows := pgxmock.NewRows(MessageColumns())
	for _, m := range messages {
		rows.AddRow(MessageValues(m)...)
	}
	return rows
}

// AuditLogColumns returns audit_logs columns in sqlc SELECT/RETURNING order.
func AuditLogColumns() []string {
	return []string{
		"id", "timestamp", "user_id", "organization_id", "action", "resource",
		"resource_id", "ip_address", "user_agent", "details", "success", "error_message",
	}
}

// AuditLog specifies an audit_logs row for mock tests.
type AuditLog struct {
	ID             int32
	Timestamp      any
	UserID         *string
	OrganizationID *int32
	Action         string
	Resource       string
	ResourceID     *string
	IpAddress      *string
	UserAgent      *string
	Details        []byte
	Success        bool
	ErrorMessage   *string
}

// AuditLogValues returns column values in AuditLogColumns() order.
func AuditLogValues(a AuditLog) []any {
	now := time.Now()
	ts := a.Timestamp
	if ts == nil {
		ts = pgtype.Timestamp{Time: now, Valid: true}
	}
	action := a.Action
	if action == "" {
		action = "login"
	}
	resource := a.Resource
	if resource == "" {
		resource = "user"
	}
	details := a.Details
	if details == nil {
		details = []byte("{}")
	}
	id := a.ID
	if id == 0 {
		id = 1
	}
	return []any{
		id, ts, a.UserID, a.OrganizationID, action, resource,
		a.ResourceID, a.IpAddress, a.UserAgent, details, a.Success, a.ErrorMessage,
	}
}

// AuditLogRow returns a single audit_logs mock row.
func AuditLogRow(a AuditLog) *pgxmock.Rows {
	return pgxmock.NewRows(AuditLogColumns()).AddRow(AuditLogValues(a)...)
}

// AuditLogRows returns one row per audit log.
func AuditLogRows(logs ...AuditLog) *pgxmock.Rows {
	rows := pgxmock.NewRows(AuditLogColumns())
	for _, a := range logs {
		rows.AddRow(AuditLogValues(a)...)
	}
	return rows
}
