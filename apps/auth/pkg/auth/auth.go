// Package auth provides authentication services.
package auth

import (
	"context"
	"errors"
	"time"
)

// --- Auth User (Session/Domain) ---

type AuthUser struct {
	ID                    int        `json:"id"`
	Email                 string     `json:"email"`
	FullName              *string    `json:"full_name"`
	Plan                  *string    `json:"plan"`
	MessageCount          *int       `json:"message_count"`
	Disabled              bool       `json:"disabled"`
	IsAdmin               bool       `json:"is_admin"`
	SubscriptionID        *string    `json:"subscription_id"`
	SubscriptionStatus    *string    `json:"subscription_status"`
	SubscriptionSource    *string    `json:"subscription_source"`
	CurrentPeriodStart    *time.Time `json:"current_period_start"`
	CurrentPeriodEnd      *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd     bool       `json:"cancel_at_period_end"`
	ThemePreference       *string    `json:"theme_preference"`
	MemoryEnabled         bool       `json:"memory_enabled"`
	WebSearchEnabled      bool       `json:"web_search_enabled"`
	CodeExecutionEnabled  bool       `json:"code_execution_enabled"`
	NotificationsEnabled  bool       `json:"notifications_enabled"`
	QuickModeEnabled      bool       `json:"quick_mode_enabled"`
	TrustLayerEnabled     bool       `json:"trust_layer_enabled"`
	MFAEnabled            bool       `json:"mfa_enabled"`
	MFATOTPSecret         *string    `json:"mfa_totp_secret,omitempty"`
	CustomerID            *string    `json:"customer_id"`
	APIRequestsUsed       *int       `json:"api_requests_used"`
	APIRequestsLimit      *int       `json:"api_requests_limit"`
	APICurrentPeriodStart *time.Time `json:"api_current_period_start"`
	APICurrentPeriodEnd   *time.Time `json:"api_current_period_end"`
	LastMessageTimestamp  *time.Time `json:"last_message_timestamp"`
	ImpersonatorID        *string    `json:"impersonator_id,omitempty"`
}

type AuthUserRepository interface {
	FindByEmail(ctx context.Context, email string) (*AuthUser, error)
	FindByID(ctx context.Context, id int) (*AuthUser, error)
	// Availability methods might be handled by circuit breaker wrapper, keeping interface simple
	// MarkUnavailable() void
	// IsUnavailable() bool
}

// --- Login Domain ---

type LoginUserRecord struct {
	ID       int     `json:"id"`
	Email    string  `json:"email"`
	FullName *string `json:"full_name"`
	Disabled bool    `json:"disabled"`
}

type LoginRepository interface {
	FindLoginByEmail(ctx context.Context, email string) (*LoginUserRecord, error)
}

// --- Register Domain ---

type ExistingUserRecord struct {
	Email string `json:"email"`
}

type RegisterUserRecord struct {
	ID                   int        `json:"id"`
	Email                string     `json:"email"`
	FullName             *string    `json:"full_name"`
	Disabled             bool       `json:"disabled"`
	Plan                 *string    `json:"plan"`
	MessageCount         *int       `json:"message_count"`
	LastMessageTimestamp *time.Time `json:"last_message_timestamp"`
	IsAdmin              bool       `json:"is_admin"`
	SubscriptionID       *string    `json:"subscription_id"`
	SubscriptionStatus   *string    `json:"subscription_status"`
	SubscriptionSource   *string    `json:"subscription_source"`
	CurrentPeriodStart   *time.Time `json:"current_period_start"`
	CurrentPeriodEnd     *time.Time `json:"current_period_end"`
	CancelAtPeriodEnd    bool       `json:"cancel_at_period_end"`
	ThemePreference      *string    `json:"theme_preference"`
	MemoryEnabled        bool       `json:"memory_enabled"`
	WebSearchEnabled     bool       `json:"web_search_enabled"`
	CodeExecutionEnabled bool       `json:"code_execution_enabled"`
	NotificationsEnabled bool       `json:"notifications_enabled"`
	QuickModeEnabled     bool       `json:"quick_mode_enabled"`
	TrustLayerEnabled    bool       `json:"trust_layer_enabled"`
	CustomerID           *string    `json:"customer_id"`
}

type RegisterUserInput struct {
	Email    string
	FullName *string
}

type RegisterRepository interface {
	FindExistingUser(ctx context.Context, email string) (*ExistingUserRecord, error)
	CreateUser(ctx context.Context, input RegisterUserInput) (*RegisterUserRecord, error)
}

// --- Device Login Domain ---

type DeviceLoginStatus string

var (
	// ErrDeviceLoginNotFound is returned when no device login matches a lookup.
	ErrDeviceLoginNotFound = errors.New("device login not found")
	// ErrUserNotFound is returned when no auth user matches a lookup.
	ErrUserNotFound = errors.New("auth user not found")
	// ErrAccountNotFound is returned when no linked account matches a lookup.
	ErrAccountNotFound = errors.New("auth account not found")
)

const (
	DeviceStatusPending    DeviceLoginStatus = "PENDING"
	DeviceStatusAuthorized DeviceLoginStatus = "AUTHORIZED"
	DeviceStatusCompleted  DeviceLoginStatus = "COMPLETED"
	DeviceStatusExpired    DeviceLoginStatus = "EXPIRED"
)

type DeviceLoginRecord struct {
	ID           int               `json:"id"`
	DeviceCode   string            `json:"device_code"`
	UserCode     string            `json:"user_code"`
	Status       DeviceLoginStatus `json:"status"`
	ExpiresAt    time.Time         `json:"expires_at"`
	PollInterval int               `json:"poll_interval"`
	UserID       *int              `json:"user_id"`
	AuthorizedAt *time.Time        `json:"authorized_at"`
	LastPolledAt *time.Time        `json:"last_polled_at"`
	CompletedAt  *time.Time        `json:"completed_at"`
}

type DeviceLoginUser struct {
	ID            int     `json:"id"`
	FullName      *string `json:"full_name"`
	Email         string  `json:"email"`
	Disabled      bool    `json:"disabled"`
	OrgID         *string `json:"org_id,omitempty"`
	InternalOrgID *int    `json:"internal_org_id,omitempty"`
}

type DeviceLoginCreateInput struct {
	DeviceCode   string
	UserCode     string
	ExpiresAt    time.Time
	PollInterval int
}

type DeviceLoginUpdate struct {
	Status       *DeviceLoginStatus
	UserID       *int
	AuthorizedAt *time.Time
	LastPolledAt *time.Time
	CompletedAt  *time.Time
}

type DeviceLoginRepository interface {
	FindActiveLoginByCodes(ctx context.Context, deviceCode, userCode string) (*DeviceLoginRecord, error)
	CreateLogin(ctx context.Context, input DeviceLoginCreateInput) (*DeviceLoginRecord, error)
	FindByUserCode(ctx context.Context, userCode string) (*DeviceLoginRecord, error)
	FindByDeviceCode(ctx context.Context, deviceCode string) (*DeviceLoginRecord, error)
	UpdateLogin(ctx context.Context, id int, update DeviceLoginUpdate) error
	RecordDeviceLoginPoll(ctx context.Context, id int, polledAt time.Time) (bool, error)
	MarkDeviceLoginAsCompleted(ctx context.Context, id int) (bool, error)
	FindUserByID(ctx context.Context, userID int) (*DeviceLoginUser, error)
}

// --- Account Domain (OAuth) ---

type AccountRecord struct {
	ID                string  `json:"id"`
	UserID            int     `json:"user_id"`
	Type              string  `json:"type"`
	Provider          string  `json:"provider"`
	ProviderAccountID string  `json:"provider_account_id"`
	RefreshToken      *string `json:"refresh_token"`
	AccessToken       *string `json:"access_token"`
	ExpiresAt         *int    `json:"expires_at"`
	TokenType         *string `json:"token_type"`
	Scope             *string `json:"scope"`
	IDToken           *string `json:"id_token"`
	SessionState      *string `json:"session_state"`
}

type CreateAccountInput struct {
	UserID            int
	Type              string
	Provider          string
	ProviderAccountID string
	RefreshToken      *string
	AccessToken       *string
	ExpiresAt         *int
	TokenType         *string
	Scope             *string
	IDToken           *string
	SessionState      *string
}

type AccountRepository interface {
	GetAccountByProvider(ctx context.Context, provider, providerAccountID string) (*AccountRecord, error)
	CreateAccount(ctx context.Context, input CreateAccountInput) (*AccountRecord, error)
	GetUserByAccount(ctx context.Context, provider, providerAccountID string) (*AuthUser, error)
}

// --- Audit Domain ---

type AuditLogWrite struct {
	UserID         *string
	OrganizationID *int32
	Email          *string
	Action         string
	Resource       string
	ResourceID     *string
	IPAddress      *string
	UserAgent      *string
	Details        map[string]any
	Success        bool
	ErrorMessage   *string
}

type AuditLogRepository interface {
	CreateAuditLog(ctx context.Context, data AuditLogWrite) error
}

// --- Rate Limit Domain ---

type RateLimitResult struct {
	Allowed   bool
	Remaining int
	ResetTime time.Time
}

type RateLimiter interface {
	Check(ctx context.Context, key string, limit int, window time.Duration) (*RateLimitResult, error)
}
