package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/convert"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ensure implementations satisfy interfaces
var (
	_ AuthUserRepository    = (*PgAuthRepository)(nil)
	_ LoginRepository       = (*PgAuthRepository)(nil)
	_ RegisterRepository    = (*PgAuthRepository)(nil)
	_ DeviceLoginRepository = (*PgAuthRepository)(nil)
	_ AccountRepository     = (*PgAuthRepository)(nil)
	_ AuditLogRepository    = (*PgAuthRepository)(nil)
)

// PgAuthRepository implements all auth-related repository interfaces.
type PgAuthRepository struct {
	q              *db.Queries
	auditSavepoint bool
}

// Compatibility constructors - all return the same underlying implementation
func NewAuthUserRepository(q *db.Queries) AuthUserRepository {
	return &PgAuthRepository{q: q}
}

// NewTransactionalAuthUserRepository isolates optional audit writes behind a
// savepoint so an audit failure cannot abort the caller's account transaction.
func NewTransactionalAuthUserRepository(q *db.Queries) AuthUserRepository {
	return &PgAuthRepository{q: q, auditSavepoint: true}
}

// Lazy repository implementation that resolves queries per request
type LazyAuthRepository struct {
	getQueries func(ctx context.Context) (*db.Queries, error)
}

func (r *LazyAuthRepository) FindByEmail(ctx context.Context, email string) (*AuthUser, error) {
	q, err := r.getQueries(ctx)
	if err != nil {
		return nil, err
	}
	return NewAuthUserRepository(q).FindByEmail(ctx, email)
}

func (r *LazyAuthRepository) FindByID(ctx context.Context, id int) (*AuthUser, error) {
	q, err := r.getQueries(ctx)
	if err != nil {
		return nil, err
	}
	return NewAuthUserRepository(q).FindByID(ctx, id)
}

func NewLazyAuthUserRepository(get func(context.Context) (*db.Queries, error)) AuthUserRepository {
	return &LazyAuthRepository{getQueries: get}
}
func NewRegisterRepository(q *db.Queries) RegisterRepository       { return &PgAuthRepository{q: q} }
func NewDeviceLoginRepository(q *db.Queries) DeviceLoginRepository { return &PgAuthRepository{q: q} }
func NewAccountRepository(q *db.Queries) AccountRepository         { return &PgAuthRepository{q: q} }
func NewAuditLogRepository(q *db.Queries) AuditLogRepository       { return &PgAuthRepository{q: q} }

// --- Audit Implementation ---

func (r *PgAuthRepository) CreateAuditLog(ctx context.Context, data AuditLogWrite) error {
	if r.q == nil {
		return errors.New("db: queries not initialized")
	}
	var details []byte
	if data.Details != nil {
		var err error
		sanitized := handler.SanitizeMetadata(data.Details)
		details, err = json.Marshal(sanitized)
		if err != nil {
			return fmt.Errorf("db: failed to marshal audit details: %w", err)
		}
	}

	params := db.CreateAuditLogParams{
		UserID:         data.UserID,
		OrganizationID: data.OrganizationID,
		Action:         data.Action,
		Resource:       data.Resource,
		ResourceID:     data.ResourceID,
		IpAddress:      data.IPAddress,
		UserAgent:      data.UserAgent,
		Details:        details,
		Success:        data.Success,
		ErrorMessage:   data.ErrorMessage,
	}
	write := func(q *db.Queries) error {
		_, err := q.CreateAuditLog(ctx, params)
		return err
	}
	var err error
	if tx, ok := r.q.GetDB().(pgx.Tx); r.auditSavepoint && ok {
		// A nested pgx transaction is a savepoint. Rolling it back keeps an
		// optional audit failure from poisoning the caller's account transaction.
		err = pgx.BeginFunc(ctx, tx, func(nested pgx.Tx) error {
			return write(db.New(nested))
		})
	} else {
		err = write(r.q)
	}
	if err != nil {
		slog.Error("Failed to create auth audit log", "action", data.Action, "userId", data.UserID, "error", err)
		return fmt.Errorf("db: failed to create audit log: %w", err)
	}
	return nil
}

// --- Device Login Implementation ---

func (r *PgAuthRepository) FindActiveLoginByCodes(ctx context.Context, deviceCode, userCode string) (*DeviceLoginRecord, error) {
	dl, err := r.q.GetDeviceLoginByCodes(ctx, db.GetDeviceLoginByCodesParams{
		DeviceCode: deviceCode,
		UserCode:   userCode,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDeviceLoginNotFound
		}
		slog.Error("Failed to find active device login", "error", err)
		return nil, fmt.Errorf("db: failed to get device login by codes: %w", err)
	}
	return mapDbDeviceLogin(&dl), nil
}

func (r *PgAuthRepository) CreateLogin(ctx context.Context, input DeviceLoginCreateInput) (*DeviceLoginRecord, error) {
	pollInterval, err := convert.Int32(input.PollInterval, "poll_interval")
	if err != nil {
		return nil, err
	}
	dl, err := r.q.CreateDeviceLogin(ctx, db.CreateDeviceLoginParams{
		DeviceCode:   input.DeviceCode,
		UserCode:     input.UserCode,
		PollInterval: pollInterval,
		ExpiresAt:    pgtype.Timestamp{Time: input.ExpiresAt, Valid: true},
	})
	if err != nil {
		slog.Error("Failed to create device login", "error", err)
		return nil, fmt.Errorf("db: failed to create device login: %w", err)
	}
	return mapDbDeviceLogin(&dl), nil
}

func (r *PgAuthRepository) FindByUserCode(ctx context.Context, userCode string) (*DeviceLoginRecord, error) {
	dl, err := r.q.GetDeviceLoginByUserCode(ctx, userCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDeviceLoginNotFound
		}
		slog.Error("Failed to find device login by user code", "userCode", userCode, "error", err)
		return nil, fmt.Errorf("db: failed to get device login by user code: %w", err)
	}
	return mapDbDeviceLogin(&dl), nil
}

func (r *PgAuthRepository) FindByDeviceCode(ctx context.Context, deviceCode string) (*DeviceLoginRecord, error) {
	dl, err := r.q.GetDeviceLoginByDeviceCode(ctx, deviceCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDeviceLoginNotFound
		}
		slog.Error("Failed to find device login by device code", "error", err)
		return nil, fmt.Errorf("db: failed to get device login by device code: %w", err)
	}
	return mapDbDeviceLogin(&dl), nil
}

func (r *PgAuthRepository) UpdateLogin(ctx context.Context, id int, update DeviceLoginUpdate) error {
	loginID, err := convert.Int32(id, "id")
	if err != nil {
		return err
	}
	var userID32 *int32
	if update.UserID != nil {
		uid, err := convert.Int32(*update.UserID, "user_id")
		if err != nil {
			return err
		}
		userID32 = &uid
	}
	var organizationID32 *int32
	if update.InternalOrgID != nil {
		orgID, err := convert.Int32(*update.InternalOrgID, "organization_id")
		if err != nil {
			return err
		}
		organizationID32 = &orgID
	}

	// Atomic authorization path: avoid check-then-update races that can overwrite user_id.
	if update.Status != nil && *update.Status == DeviceStatusAuthorized && userID32 != nil && update.AuthorizedAt != nil {
		rows, err := r.q.AuthorizeDeviceLoginIfPending(ctx, db.AuthorizeDeviceLoginIfPendingParams{
			ID:             loginID,
			UserID:         userID32,
			OrganizationID: organizationID32,
			AuthorizedAt:   pgtype.Timestamp{Time: *update.AuthorizedAt, Valid: true},
		})
		if err != nil {
			slog.Error("Failed to authorize device login atomically", "loginId", id, "error", err)
			return fmt.Errorf("db: failed to authorize device login: %w", err)
		}
		if rows == 0 {
			return ErrAlreadyUsed
		}
		return nil
	}

	params := db.UpdateDeviceLoginParams{
		ID: loginID,
	}
	if update.Status != nil {
		s := db.DeviceLoginsStatus(string(*update.Status))
		params.Status = &s
	}
	if userID32 != nil {
		params.UserID = userID32
	}
	if update.AuthorizedAt != nil {
		params.AuthorizedAt = pgtype.Timestamp{Time: *update.AuthorizedAt, Valid: true}
	}
	if update.CompletedAt != nil {
		params.CompletedAt = pgtype.Timestamp{Time: *update.CompletedAt, Valid: true}
	}
	if update.LastPolledAt != nil {
		params.LastPolledAt = pgtype.Timestamp{Time: *update.LastPolledAt, Valid: true}
	}

	if err := r.q.UpdateDeviceLogin(ctx, params); err != nil {
		slog.Error("Failed to update device login", "loginId", id, "error", err)
		return fmt.Errorf("db: failed to update device login: %w", err)
	}
	return nil
}

func (r *PgAuthRepository) RecordDeviceLoginPoll(ctx context.Context, id int, polledAt time.Time) (bool, error) {
	loginID, err := convert.Int32(id, "id")
	if err != nil {
		return false, err
	}

	rows, err := r.q.RecordDeviceLoginPollIfDue(ctx, db.RecordDeviceLoginPollIfDueParams{
		ID:           loginID,
		LastPolledAt: pgtype.Timestamp{Time: polledAt, Valid: true},
	})
	if err != nil {
		slog.Error("Failed to record device login poll atomically", "loginId", id, "error", err)
		return false, fmt.Errorf("db: failed to record login poll: %w", err)
	}
	return rows > 0, nil
}

func (r *PgAuthRepository) MarkDeviceLoginAsCompleted(ctx context.Context, id int) (bool, error) {
	loginID, err := convert.Int32(id, "id")
	if err != nil {
		return false, err
	}

	params := db.CompleteDeviceLoginIfAuthorizedParams{
		ID:          loginID,
		CompletedAt: pgtype.Timestamp{Time: time.Now(), Valid: true},
	}

	rows, err := r.q.CompleteDeviceLoginIfAuthorized(ctx, params)
	if err != nil {
		slog.Error("Failed to mark device login completed", "loginId", id, "error", err)
		return false, fmt.Errorf("db: failed to mark login completed: %w", err)
	}

	return rows > 0, nil
}

func (r *PgAuthRepository) FindUserByID(ctx context.Context, userID int) (*DeviceLoginUser, error) {
	return r.findUserByIDForOrganization(ctx, userID, nil)
}

func (r *PgAuthRepository) FindUserByIDForOrganization(ctx context.Context, userID int, internalOrgID int) (*DeviceLoginUser, error) {
	return r.findUserByIDForOrganization(ctx, userID, &internalOrgID)
}

func (r *PgAuthRepository) findUserByIDForOrganization(ctx context.Context, userID int, internalOrgID *int) (*DeviceLoginUser, error) {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return nil, err
	}
	user, err := findAuthDBUser(ctx, "device login user by ID", func(ctx context.Context) (db.User, error) {
		return r.q.GetUserByID(ctx, dbUserID)
	}, "userId", userID)
	if err != nil {
		return nil, err
	}
	deviceUser := &DeviceLoginUser{
		ID:       int(user.ID),
		FullName: user.FullName,
		Email:    user.Email,
		Disabled: user.Disabled,
	}
	if internalOrgID == nil {
		return deviceUser, nil
	}
	if err := r.populateDeviceUserOrganization(ctx, deviceUser, user.ID, *internalOrgID); err != nil {
		return nil, err
	}
	return deviceUser, nil
}

func (r *PgAuthRepository) populateDeviceUserOrganization(ctx context.Context, deviceUser *DeviceLoginUser, userID int32, internalOrgID int) error {
	orgID, err := convert.Int32(internalOrgID, "organization_id")
	if err != nil {
		return err
	}
	if _, err := r.q.GetMembership(ctx, db.GetMembershipParams{OrganizationID: orgID, UserID: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidUser
		}
		return fmt.Errorf("db: failed to validate device login membership: %w", err)
	}
	deviceUser.InternalOrgID = &internalOrgID

	org, err := r.q.GetOrganizationByID(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("db: failed to get device login user organization: %w", err)
	}
	if org.WorkosOrganizationID != nil && *org.WorkosOrganizationID != "" {
		workosOrgID := *org.WorkosOrganizationID
		deviceUser.OrgID = &workosOrgID
	}
	return nil
}

// --- Auth User Implementation ---

func (r *PgAuthRepository) FindByEmail(ctx context.Context, email string) (*AuthUser, error) {
	user, err := findAuthDBUser(ctx, "user by email", func(ctx context.Context) (db.User, error) {
		return r.q.GetUserByEmail(ctx, email)
	}, "email", email)
	if err != nil {
		return nil, err
	}
	return mapDbUserToAuthUser(user), nil
}

func (r *PgAuthRepository) FindByID(ctx context.Context, id int) (*AuthUser, error) {
	dbID, err := convert.Int32(id, "id")
	if err != nil {
		return nil, err
	}
	user, err := findAuthDBUser(ctx, "user by ID", func(ctx context.Context) (db.User, error) {
		return r.q.GetUserByID(ctx, dbID)
	}, "userId", id)
	if err != nil {
		return nil, err
	}
	return mapDbUserToAuthUser(user), nil
}

// --- Login Implementation ---

func (r *PgAuthRepository) FindLoginByEmail(ctx context.Context, email string) (*LoginUserRecord, error) {
	user, err := findAuthDBUser(ctx, "login by email", func(ctx context.Context) (db.User, error) {
		return r.q.GetUserByEmail(ctx, email)
	}, "email", email)
	if err != nil {
		return nil, err
	}
	return &LoginUserRecord{
		ID:       int(user.ID),
		Email:    user.Email,
		FullName: user.FullName,
		Disabled: user.Disabled,
	}, nil
}

// --- Register Implementation ---

func (r *PgAuthRepository) FindExistingUser(ctx context.Context, email string) (*ExistingUserRecord, error) {
	user, err := r.q.GetUserByEmail(ctx, email)
	if err == nil {
		return &ExistingUserRecord{Email: user.Email}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("Failed to check existing user", "email", email, "error", err)
		return nil, fmt.Errorf("db: failed to check existing user: %w", err)
	}
	return nil, ErrUserNotFound
}

func (r *PgAuthRepository) CreateUser(ctx context.Context, input RegisterUserInput) (*RegisterUserRecord, error) {
	user, err := r.q.CreateUser(ctx, db.CreateUserParams{
		Email:    input.Email,
		FullName: input.FullName,
		Plan:     "free",
	})
	if err != nil {
		if isUniqueViolation(err) {
			existing, fetchErr := r.q.GetUserByEmail(ctx, input.Email)
			if fetchErr == nil {
				return mapDbUserToRegisterUser(&existing), nil
			}
		}
		slog.Error("Failed to create user", "email", input.Email, "error", err)
		return nil, fmt.Errorf("db: failed to create user: %w", err)
	}

	return mapDbUserToRegisterUser(&user), nil
}

// --- Account Implementation ---

func (r *PgAuthRepository) GetAccountByProvider(ctx context.Context, provider, providerAccountID string) (*AccountRecord, error) {
	acc, err := r.q.GetAccountByProvider(ctx, db.GetAccountByProviderParams{
		Provider:          provider,
		Provideraccountid: providerAccountID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountNotFound
		}
		slog.Error("Failed to find account by provider", "provider", provider, "providerAccountId", providerAccountID, "error", err)
		return nil, fmt.Errorf("db: failed to get account by provider: %w", err)
	}
	return mapDbAccount(&acc), nil
}

func (r *PgAuthRepository) CreateAccount(ctx context.Context, input CreateAccountInput) (*AccountRecord, error) {
	id := uuid.New().String()

	if len(input.ProviderAccountID) > 255 {
		return nil, errors.New("provider_account_id too long")
	}

	var expiresAt *int32
	if input.ExpiresAt != nil {
		expires, err := convert.Int32(*input.ExpiresAt, "expires_at")
		if err != nil {
			return nil, err
		}
		expiresAt = &expires
	}

	userID, err := convert.Int32(input.UserID, "user_id")
	if err != nil {
		return nil, err
	}

	// Encrypt OAuth tokens before storage.
	encRefresh, err := infracrypto.EncryptOAuthTokenField(input.RefreshToken)
	if err != nil {
		slog.Error("Failed to encrypt OAuth refresh token", "userId", input.UserID, "provider", input.Provider, "error", err)
		return nil, fmt.Errorf("db: failed to encrypt refresh token: %w", err)
	}
	encAccess, err := infracrypto.EncryptOAuthTokenField(input.AccessToken)
	if err != nil {
		slog.Error("Failed to encrypt OAuth access token", "userId", input.UserID, "provider", input.Provider, "error", err)
		return nil, fmt.Errorf("db: failed to encrypt access token: %w", err)
	}
	encIDToken, err := infracrypto.EncryptOAuthTokenField(input.IDToken)
	if err != nil {
		slog.Error("Failed to encrypt OAuth ID token", "userId", input.UserID, "provider", input.Provider, "error", err)
		return nil, fmt.Errorf("db: failed to encrypt id token: %w", err)
	}

	acc, err := r.q.CreateAccount(ctx, db.CreateAccountParams{
		ID:                id,
		UserID:            userID,
		Type:              input.Type,
		Provider:          input.Provider,
		Provideraccountid: input.ProviderAccountID,
		RefreshToken:      encRefresh,
		AccessToken:       encAccess,
		ExpiresAt:         expiresAt,
		TokenType:         input.TokenType,
		Scope:             input.Scope,
		IDToken:           encIDToken,
		SessionState:      input.SessionState,
	})
	if err != nil {
		if account, handled, handledErr := r.handleCreateAccountConflict(ctx, input, err); handled {
			return account, handledErr
		}
		slog.Error("Failed to create OAuth account record", "userId", input.UserID, "provider", input.Provider, "error", err)
		return nil, fmt.Errorf("db: failed to create account: %w", err)
	}
	return mapDbAccount(&acc), nil
}

func (r *PgAuthRepository) handleCreateAccountConflict(
	ctx context.Context,
	input CreateAccountInput,
	createErr error,
) (*AccountRecord, bool, error) {
	if !isUniqueViolation(createErr) && !errors.Is(createErr, pgx.ErrNoRows) {
		return nil, false, nil
	}
	existing, found := r.accountByProvider(ctx, input)
	if !found {
		return nil, false, nil
	}
	if int(existing.UserID) == input.UserID {
		return mapDbAccount(existing), true, nil
	}
	return nil, true, fmt.Errorf("db: provider account already linked to a different user")
}

func (r *PgAuthRepository) accountByProvider(ctx context.Context, input CreateAccountInput) (*db.Account, bool) {
	existing, err := r.q.GetAccountByProvider(ctx, db.GetAccountByProviderParams{
		Provider:          input.Provider,
		Provideraccountid: input.ProviderAccountID,
	})
	if err != nil {
		return nil, false
	}
	return &existing, true
}

func (r *PgAuthRepository) GetUserByAccount(ctx context.Context, provider, providerAccountID string) (*AuthUser, error) {
	user, err := findAuthDBUser(ctx, "user by account", func(ctx context.Context) (db.User, error) {
		return r.q.GetUserByAccount(ctx, db.GetUserByAccountParams{
			Provider:          provider,
			Provideraccountid: providerAccountID,
		})
	}, "provider", provider)
	if err != nil {
		return nil, err
	}
	return mapDbUserToAuthUser(user), nil
}

// --- Mappers & Helpers ---

func findAuthDBUser(
	ctx context.Context,
	operation string,
	loadUser func(context.Context) (db.User, error),
	logKey string,
	logValue any,
) (*db.User, error) {
	user, err := loadUser(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		slog.Error("Failed to find auth user", "operation", operation, logKey, logValue, "error", err)
		return nil, fmt.Errorf("db: failed to get %s: %w", operation, err)
	}
	return &user, nil
}

func isUniqueViolation(err error) bool {
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pgErr.Code == "23505"
	}
	return false
}

func mapDbDeviceLogin(dl *db.DeviceLogin) *DeviceLoginRecord {
	var userID *int
	if dl.UserID != nil {
		id := int(*dl.UserID)
		userID = &id
	}
	var internalOrgID *int
	if dl.OrganizationID != nil {
		id := int(*dl.OrganizationID)
		internalOrgID = &id
	}

	return &DeviceLoginRecord{
		ID:            int(dl.ID),
		DeviceCode:    dl.DeviceCode,
		UserCode:      dl.UserCode,
		Status:        DeviceLoginStatus(string(dl.Status)),
		ExpiresAt:     dl.ExpiresAt.Time,
		PollInterval:  int(dl.PollInterval),
		UserID:        userID,
		InternalOrgID: internalOrgID,
		AuthorizedAt:  timestamptzToTimeVal(dl.AuthorizedAt),
		LastPolledAt:  timestamptzToTimeVal(dl.LastPolledAt),
		CompletedAt:   timestamptzToTimeVal(dl.CompletedAt),
	}
}

func mapDbUserToAuthUser(u *db.User) *AuthUser {
	user := account.FromDBUser(*u)

	return &AuthUser{
		ID:                    int(user.ID),
		Email:                 user.Email,
		FullName:              user.FullName,
		Plan:                  &user.Plan,
		MessageCount:          new(int(user.MessageCount)),
		Disabled:              user.Disabled,
		IsAdmin:               user.IsAdmin,
		SubscriptionID:        user.SubscriptionID,
		SubscriptionStatus:    user.SubscriptionStatus,
		SubscriptionSource:    user.SubscriptionSource,
		CurrentPeriodStart:    user.CurrentPeriodStart,
		CurrentPeriodEnd:      user.CurrentPeriodEnd,
		CancelAtPeriodEnd:     user.CancelAtPeriodEnd,
		ThemePreference:       &user.ThemePreference,
		MemoryEnabled:         user.MemoryEnabled,
		WebSearchEnabled:      user.WebSearchEnabled,
		CodeExecutionEnabled:  user.CodeExecutionEnabled,
		NotificationsEnabled:  user.NotificationsEnabled,
		QuickModeEnabled:      user.QuickModeEnabled,
		TrustLayerEnabled:     user.TrustLayerEnabled,
		MFAEnabled:            u.MfaEnabled,
		MFATOTPSecret:         u.MfaTotpSecret,
		CustomerID:            user.CustomerID,
		APIRequestsUsed:       new(int(user.APIRequestsUsed)),
		APIRequestsLimit:      new(int(user.APIRequestsLimit)),
		APICurrentPeriodStart: user.APICurrentPeriodStart,
		APICurrentPeriodEnd:   user.APICurrentPeriodEnd,
		LastMessageTimestamp:  user.LastMessageTimestamp,
	}
}

func mapDbUserToRegisterUser(u *db.User) *RegisterUserRecord {
	user := account.FromDBUser(*u)

	return &RegisterUserRecord{
		ID:                   int(user.ID),
		Email:                user.Email,
		FullName:             user.FullName,
		Disabled:             user.Disabled,
		Plan:                 &user.Plan,
		MessageCount:         new(int(user.MessageCount)),
		LastMessageTimestamp: user.LastMessageTimestamp,
		IsAdmin:              user.IsAdmin,
		SubscriptionID:       user.SubscriptionID,
		SubscriptionStatus:   user.SubscriptionStatus,
		CancelAtPeriodEnd:    user.CancelAtPeriodEnd,
		ThemePreference:      &user.ThemePreference,
		MemoryEnabled:        user.MemoryEnabled,
		WebSearchEnabled:     user.WebSearchEnabled,
		CodeExecutionEnabled: user.CodeExecutionEnabled,
		NotificationsEnabled: user.NotificationsEnabled,
		QuickModeEnabled:     user.QuickModeEnabled,
		TrustLayerEnabled:    user.TrustLayerEnabled,
		CustomerID:           user.CustomerID,
	}
}

//go:fix inline

func mapDbAccount(a *db.Account) *AccountRecord {
	var expiresAt *int
	if a.ExpiresAt != nil {
		e := int(*a.ExpiresAt)
		expiresAt = &e
	}

	refreshToken, err := infracrypto.DecryptOAuthTokenField(a.RefreshToken)
	if err != nil {
		slog.Warn("failed to decrypt refresh token", "error", err, "provider", a.Provider, "accountID", a.ID)
	}
	accessToken, err := infracrypto.DecryptOAuthTokenField(a.AccessToken)
	if err != nil {
		slog.Warn("failed to decrypt access token", "error", err, "provider", a.Provider, "accountID", a.ID)
	}
	idToken, err := infracrypto.DecryptOAuthTokenField(a.IDToken)
	if err != nil {
		slog.Warn("failed to decrypt id token", "error", err, "provider", a.Provider, "accountID", a.ID)
	}

	return &AccountRecord{
		ID:                a.ID,
		UserID:            int(a.UserID),
		Type:              a.Type,
		Provider:          a.Provider,
		ProviderAccountID: a.Provideraccountid,
		RefreshToken:      refreshToken,
		AccessToken:       accessToken,
		ExpiresAt:         expiresAt,
		TokenType:         a.TokenType,
		Scope:             a.Scope,
		IDToken:           idToken,
		SessionState:      a.SessionState,
	}
}

func timestamptzToTimeVal(t pgtype.Timestamp) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}
