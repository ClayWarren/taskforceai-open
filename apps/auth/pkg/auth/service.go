package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
)

var (
	ErrUserDisabled = errors.New("user disabled")
)

const auditLogWriteTimeout = 3 * time.Second

// --- Linker Service ---

type UserLinker interface {
	LinkOrCreateExternalUser(ctx context.Context, identity ExternalIdentity) (*AuthUser, error)
}

// ExternalIdentity is the provider-neutral identity accepted by the auth use case.
type ExternalIdentity struct {
	Provider   string
	ProviderID string
	Email      string
	FirstName  string
	LastName   string
}

// Telemetry records auth outcomes without exposing a concrete telemetry SDK to
// the use-case layer.
type Telemetry interface {
	StartOperation(context.Context, string, map[string]string) (context.Context, func(error))
	RecordLogin(context.Context, string, bool)
	RecordRegistration(context.Context, bool)
}

type LinkerService struct {
	UserRepo    AuthUserRepository
	AccountRepo AccountRepository
	RegRepo     RegisterRepository
	telemetry   Telemetry
}

func NewLinkerService(userRepo AuthUserRepository, accountRepo AccountRepository, regRepo RegisterRepository, telemetry ...Telemetry) *LinkerService {
	var telemetryPort Telemetry = noopTelemetry{}
	if len(telemetry) > 0 && telemetry[0] != nil {
		telemetryPort = telemetry[0]
	}
	return &LinkerService{
		UserRepo:    userRepo,
		AccountRepo: accountRepo,
		RegRepo:     regRepo,
		telemetry:   telemetryPort,
	}
}

func (s *LinkerService) LinkOrCreateExternalUser(ctx context.Context, identity ExternalIdentity) (_ *AuthUser, err error) {
	provider := strings.ToLower(strings.TrimSpace(identity.Provider))
	ctx, finish := s.telemetry.StartOperation(ctx, "auth.LinkOrCreateExternalUser", map[string]string{"provider": provider})
	defer func() { finish(err) }()

	providerID := strings.TrimSpace(identity.ProviderID)
	email := strings.ToLower(strings.TrimSpace(identity.Email))
	if !isValidEmail(email) {
		s.telemetry.RecordLogin(ctx, provider, false)
		return nil, fmt.Errorf("linker: invalid email format")
	}
	if provider == "" || providerID == "" {
		s.telemetry.RecordLogin(ctx, provider, false)
		return nil, fmt.Errorf("linker: provider and provider id are required")
	}

	// Check Account
	existingUser, err := s.AccountRepo.GetUserByAccount(ctx, provider, providerID)
	if errors.Is(err, ErrUserNotFound) {
		existingUser = nil
		err = nil
	}
	if err != nil {
		return nil, fmt.Errorf("linker: failed to get user by account: %w", err)
	}

	if existingUser != nil {
		if existingUser.Disabled {
			s.telemetry.RecordLogin(ctx, provider, false)
			return nil, ErrUserDisabled
		}
		s.telemetry.RecordLogin(ctx, provider, true)
		return existingUser, nil
	}

	// Account doesn't exist, check email
	var user *AuthUser
	existingEmailUser, err := s.UserRepo.FindByEmail(ctx, email)
	if errors.Is(err, ErrUserNotFound) {
		existingEmailUser = nil
		err = nil
	}
	if err != nil {
		return nil, fmt.Errorf("linker: failed to find user by email: %w", err)
	}

	var fullName string
	if identity.FirstName != "" || identity.LastName != "" {
		fullName = strings.TrimSpace(identity.FirstName + " " + identity.LastName)
	}

	user = existingEmailUser
	if user == nil {
		user, err = s.createUserFromExternalIdentity(ctx, email, fullName)
		if err != nil {
			return nil, err
		}
	}
	if user.Disabled {
		s.telemetry.RecordLogin(ctx, provider, false)
		return nil, ErrUserDisabled
	}

	// Create Account Link
	_, err = s.AccountRepo.CreateAccount(ctx, CreateAccountInput{
		UserID:            user.ID,
		Type:              "oauth",
		Provider:          provider,
		ProviderAccountID: providerID,
	})
	if err != nil {
		return nil, fmt.Errorf("linker: failed to create account link: %w", err)
	}

	s.telemetry.RecordLogin(ctx, provider, true)
	return user, nil
}

func (s *LinkerService) createUserFromExternalIdentity(ctx context.Context, email string, fullName string) (*AuthUser, error) {
	input := RegisterUserInput{Email: email}
	if fullName != "" {
		input.FullName = &fullName
	}

	newUser, err := s.RegRepo.CreateUser(ctx, input)
	if err != nil {
		s.telemetry.RecordRegistration(ctx, false)
		return nil, fmt.Errorf("linker: failed to create user: %w", err)
	}

	user := &AuthUser{
		ID:       newUser.ID,
		Email:    newUser.Email,
		FullName: newUser.FullName,
	}
	s.logUserCreated(ctx, user)
	s.telemetry.RecordRegistration(ctx, true)
	return user, nil
}

type noopTelemetry struct{}

func (noopTelemetry) StartOperation(ctx context.Context, _ string, _ map[string]string) (context.Context, func(error)) {
	return ctx, func(error) {}
}

func (noopTelemetry) RecordLogin(context.Context, string, bool) {}

func (noopTelemetry) RecordRegistration(context.Context, bool) {}

func (s *LinkerService) logUserCreated(ctx context.Context, user *AuthUser) {
	uid := strconv.Itoa(user.ID)
	auditRepo, _ := s.UserRepo.(AuditLogRepository)
	if auditRepo == nil {
		return
	}
	if err := auditRepo.CreateAuditLog(ctx, AuditLogWrite{
		UserID:   &uid,
		Email:    &user.Email,
		Action:   "CREATE",
		Resource: "user",
		Success:  true,
	}); err != nil {
		slog.Error("Failed to write user creation audit log", "error", err)
	}
}

// --- Audit Service ---

type AuditService struct {
	repo AuditLogRepository
}

func NewAuditService(repo AuditLogRepository) *AuditService {
	return &AuditService{repo: repo}
}

func (s *AuditService) LogEvent(ctx context.Context, entry AuditLogWrite) {
	if s.repo == nil {
		return
	}
	auditCtx, cancel := detachedAuditContext(ctx)
	defer cancel()

	// Synchronous audit logging for serverless reliability.
	// In high-scale non-serverless systems, this could use a buffer/worker pool.
	if err := s.repo.CreateAuditLog(auditCtx, entry); err != nil {
		slog.Error("Failed to write audit log", "error", err)
	}
}

func detachedAuditContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(context.WithoutCancel(ctx), auditLogWriteTimeout)
}

func (s *AuditService) LogLogin(ctx context.Context, user *AuthUser, success bool, ip, ua *string, errMsg *string) {
	var uid *string
	if user != nil {
		s := strconv.Itoa(user.ID)
		uid = &s
	}
	var email *string
	if user != nil {
		email = &user.Email
	}

	s.LogEvent(ctx, AuditLogWrite{
		UserID:       uid,
		Email:        email,
		Action:       "LOGIN",
		Resource:     "user",
		IPAddress:    ip,
		UserAgent:    ua,
		Success:      success,
		ErrorMessage: errMsg,
	})
}
