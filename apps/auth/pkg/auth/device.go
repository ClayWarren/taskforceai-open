package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	coreidentity "github.com/TaskForceAI/core/pkg/identity"
)

var (
	ErrUnavailable    = errors.New("service unavailable") // Too many attempts
	ErrInvalidCode    = errors.New("invalid code")
	ErrExpired        = errors.New("expired")
	ErrAlreadyUsed    = errors.New("already used")
	ErrAlreadyClaimed = errors.New("already claimed")
	ErrInvalidUser    = errors.New("invalid user associated with login")

	deviceRandomReader = rand.Reader
)

const (
	LoginExpirySeconds         = coreidentity.DeviceLoginExpirySeconds
	DefaultPollInterval        = coreidentity.DeviceLoginPollIntervalSeconds
	UserCodeAlphabet           = coreidentity.DeviceLoginUserCodeAlphabet
	deviceLoginCodeMaxAttempts = coreidentity.DeviceLoginCodeGenerationMaxAttempts
)

type DeviceLoginStartPayload struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type DeviceLoginTokenOutcome struct {
	Kind        string  `json:"kind"` // PENDING, APPROVED, INVALID_CODE, EXPIRED, ALREADY_CLAIMED, INVALID_USER
	AccessToken string  `json:"accessToken,omitempty"`
	ExpiresIn   int     `json:"expiresIn,omitempty"`
	Email       *string `json:"email,omitempty"`
	Interval    int     `json:"interval,omitempty"`
}

type DeviceService interface {
	StartDeviceLogin(ctx context.Context, baseURL string) (*DeviceLoginStartPayload, error)
	AuthorizeDeviceLogin(ctx context.Context, userID int, userCode string) error
	ExchangeDeviceToken(ctx context.Context, deviceCode, secret string) (*DeviceLoginTokenOutcome, error)
}

type TenantAwareDeviceService interface {
	AuthorizeDeviceLoginForOrganization(ctx context.Context, userID int, internalOrgID *int, userCode string) error
}

type DeviceLoginServiceImpl struct {
	repo DeviceLoginRepository
}

func NewDeviceLoginService(repo DeviceLoginRepository) *DeviceLoginServiceImpl {
	return &DeviceLoginServiceImpl{repo: repo}
}

func (s *DeviceLoginServiceImpl) StartDeviceLogin(ctx context.Context, baseURL string) (*DeviceLoginStartPayload, error) {
	expiresAt := time.Now().Add(LoginExpirySeconds * time.Second)

	var codes deviceLoginCodes
	attempts := 0

	for attempts < deviceLoginCodeMaxAttempts {
		var err error
		codes, err = generateDeviceLoginCodes()
		if err != nil {
			return nil, err
		}

		existing, err := s.repo.FindActiveLoginByCodes(ctx, codes.device, codes.user)
		if errors.Is(err, ErrDeviceLoginNotFound) {
			break
		}
		if err != nil {
			slog.Error("Failed to check device login code uniqueness", "error", err)
			return nil, fmt.Errorf("device: failed to check uniqueness: %w", err)
		}
		if existing == nil {
			break
		}
		attempts++
	}

	if attempts >= deviceLoginCodeMaxAttempts {
		slog.Warn("Device login start failed after maximum attempts due to code collisions or repository issues")
		return nil, ErrUnavailable
	}

	input := DeviceLoginCreateInput{
		DeviceCode:   codes.device,
		UserCode:     codes.user,
		ExpiresAt:    expiresAt,
		PollInterval: DefaultPollInterval,
	}

	record, err := s.repo.CreateLogin(ctx, input)
	if err != nil {
		slog.Error("Failed to create device login record", "error", err)
		return nil, fmt.Errorf("device: failed to create login record: %w", err)
	}

	verificationURI := fmt.Sprintf("%s/login/device", baseURL)
	completeURI := fmt.Sprintf("%s?code=%s", verificationURI, record.UserCode)

	return &DeviceLoginStartPayload{
		DeviceCode:              record.DeviceCode,
		UserCode:                record.UserCode,
		VerificationURI:         verificationURI,
		VerificationURIComplete: completeURI,
		ExpiresIn:               LoginExpirySeconds,
		Interval:                DefaultPollInterval,
	}, nil
}

type deviceLoginCodes struct {
	device string
	user   string
}

func generateDeviceLoginCodes() (deviceLoginCodes, error) {
	bytes := make([]byte, 32)
	if _, err := io.ReadFull(deviceRandomReader, bytes); err != nil {
		return deviceLoginCodes{}, fmt.Errorf("device: failed to generate random bytes: %w", err)
	}

	userBytes := make([]byte, 8)
	if _, err := io.ReadFull(deviceRandomReader, userBytes); err != nil {
		return deviceLoginCodes{}, fmt.Errorf("device: failed to generate random bytes for user code: %w", err)
	}

	var raw strings.Builder
	raw.Grow(8)
	for _, b := range userBytes {
		raw.WriteByte(UserCodeAlphabet[int(b)%len(UserCodeAlphabet)])
	}
	rawUserCode := raw.String()

	return deviceLoginCodes{
		device: hex.EncodeToString(bytes),
		user:   fmt.Sprintf("%s-%s", rawUserCode[:4], rawUserCode[4:]),
	}, nil
}

func (s *DeviceLoginServiceImpl) AuthorizeDeviceLogin(ctx context.Context, userID int, userCode string) error {
	return s.AuthorizeDeviceLoginForOrganization(ctx, userID, nil, userCode)
}

func (s *DeviceLoginServiceImpl) AuthorizeDeviceLoginForOrganization(ctx context.Context, userID int, internalOrgID *int, userCode string) error {
	formattedCode := coreidentity.NormalizeDeviceLoginUserCode(userCode)

	record, err := s.repo.FindByUserCode(ctx, formattedCode)
	if errors.Is(err, ErrDeviceLoginNotFound) {
		return ErrInvalidCode
	}
	if err != nil {
		slog.Error("Failed to find device login by user code", "userCode", formattedCode, "error", err)
		return fmt.Errorf("device: failed to find login by user code: %w", err)
	}
	if record == nil {
		return ErrInvalidCode
	}

	if record.Status == DeviceStatusExpired || time.Now().After(record.ExpiresAt) {
		if record.Status != DeviceStatusExpired {
			status := DeviceStatusExpired
			if err := s.repo.UpdateLogin(ctx, record.ID, DeviceLoginUpdate{Status: &status}); err != nil {
				slog.Error("Failed to mark device login as expired", "loginId", record.ID, "error", err)
				return fmt.Errorf("device: failed to mark login expired: %w", err)
			}
		}
		return ErrExpired
	}

	if record.Status == DeviceStatusCompleted || record.Status == DeviceStatusAuthorized {
		return ErrAlreadyUsed
	}

	status := DeviceStatusAuthorized
	now := time.Now()
	if err := s.repo.UpdateLogin(ctx, record.ID, DeviceLoginUpdate{
		Status:        &status,
		UserID:        &userID,
		InternalOrgID: internalOrgID,
		AuthorizedAt:  &now,
	}); err != nil {
		slog.Error("Failed to authorize device login", "loginId", record.ID, "userId", userID, "error", err)
		return fmt.Errorf("device: failed to authorize login: %w", err)
	}
	return nil
}

func (s *DeviceLoginServiceImpl) ExchangeDeviceToken(ctx context.Context, deviceCode, secret string) (*DeviceLoginTokenOutcome, error) {
	record, err := s.repo.FindByDeviceCode(ctx, deviceCode)
	if errors.Is(err, ErrDeviceLoginNotFound) {
		return &DeviceLoginTokenOutcome{Kind: "INVALID_CODE"}, nil
	}
	if err != nil {
		slog.Error("Failed to find device login by device code", "error", err)
		return nil, fmt.Errorf("device: failed to find login by device code: %w", err)
	}
	if record == nil {
		return &DeviceLoginTokenOutcome{Kind: "INVALID_CODE"}, nil
	}

	now := time.Now()
	if outcome, handled, err := s.resolveDeviceExchangeState(ctx, record, now); handled || err != nil {
		return outcome, err
	}

	// Authorized, generate token
	var user *DeviceLoginUser
	if record.InternalOrgID != nil {
		orgRepo, ok := s.repo.(DeviceLoginOrganizationRepository)
		if !ok {
			return nil, fmt.Errorf("device: repository does not support organization-scoped login")
		}
		user, err = orgRepo.FindUserByIDForOrganization(ctx, *record.UserID, *record.InternalOrgID)
	} else {
		user, err = s.repo.FindUserByID(ctx, *record.UserID)
	}
	if errors.Is(err, ErrUserNotFound) {
		user = nil
		err = nil
	}
	if err != nil {
		slog.Error("Failed to resolve user for device login exchange", "userId", *record.UserID, "error", err)
		return nil, fmt.Errorf("device: failed to resolve user: %w", err)
	}
	if user == nil || user.Disabled {
		return s.rejectInvalidDeviceUser(ctx, record.ID)
	}

	// Use unified session generation
	sessionPayload := SessionUser{
		ID:            fmt.Sprintf("%d", user.ID),
		Email:         user.Email,
		OrgID:         user.OrgID,
		InternalOrgID: user.InternalOrgID,
	}
	if user.FullName != nil {
		sessionPayload.FullName = *user.FullName
	}
	expiresIn := GetSessionTTL(sessionPayload)

	signedToken, err := EncodeSessionToken(sessionPayload, secret, expiresIn)
	if err != nil {
		slog.Error("Failed to sign token for device login", "userId", user.ID, "error", err)
		return nil, fmt.Errorf("device: failed to sign token: %w", err)
	}

	// Atomic transition: ensures only one exchange succeeds
	ok, err := s.repo.MarkDeviceLoginAsCompleted(ctx, record.ID)
	if err != nil {
		slog.Error("Failed to complete device login record", "loginId", record.ID, "error", err)
		return nil, fmt.Errorf("device: failed to complete login: %w", err)
	}
	if !ok {
		return &DeviceLoginTokenOutcome{Kind: "ALREADY_CLAIMED"}, nil
	}

	return &DeviceLoginTokenOutcome{
		Kind:        "APPROVED",
		AccessToken: signedToken,
		ExpiresIn:   expiresIn,
	}, nil
}

func (s *DeviceLoginServiceImpl) resolveDeviceExchangeState(ctx context.Context, record *DeviceLoginRecord, now time.Time) (*DeviceLoginTokenOutcome, bool, error) {
	if record.Status == DeviceStatusExpired || now.After(record.ExpiresAt) {
		if record.Status != DeviceStatusExpired {
			status := DeviceStatusExpired
			if err := s.repo.UpdateLogin(ctx, record.ID, DeviceLoginUpdate{Status: &status}); err != nil {
				slog.Error("Failed to mark device login as expired during exchange", "loginId", record.ID, "error", err)
				return nil, true, fmt.Errorf("device: failed to mark login expired: %w", err)
			}
		}
		return &DeviceLoginTokenOutcome{Kind: "EXPIRED"}, true, nil
	}
	if record.Status == DeviceStatusCompleted {
		return &DeviceLoginTokenOutcome{Kind: "ALREADY_CLAIMED"}, true, nil
	}
	if record.Status == DeviceStatusAuthorized && record.UserID != nil {
		return nil, false, nil
	}
	allowed, err := s.repo.RecordDeviceLoginPoll(ctx, record.ID, now)
	if err != nil {
		slog.Error("Failed to record device login poll", "loginId", record.ID, "error", err)
		return nil, true, fmt.Errorf("device: failed to record login poll: %w", err)
	}
	if !allowed {
		return &DeviceLoginTokenOutcome{Kind: "SLOW_DOWN", Interval: record.PollInterval}, true, nil
	}
	return &DeviceLoginTokenOutcome{Kind: "PENDING", Interval: record.PollInterval}, true, nil
}

func (s *DeviceLoginServiceImpl) rejectInvalidDeviceUser(ctx context.Context, loginID int) (*DeviceLoginTokenOutcome, error) {
	status := DeviceStatusExpired
	if err := s.repo.UpdateLogin(ctx, loginID, DeviceLoginUpdate{Status: &status}); err != nil {
		slog.Error("Failed to mark device login as expired due to invalid user", "loginId", loginID, "error", err)
		return nil, fmt.Errorf("device: failed to mark login expired: %w", err)
	}
	return &DeviceLoginTokenOutcome{Kind: "INVALID_USER"}, nil
}
