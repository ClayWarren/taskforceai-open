package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
)

type OrganizationRole string

const (
	RoleOwner  OrganizationRole = "owner"
	RoleAdmin  OrganizationRole = "admin"
	RoleMember OrganizationRole = "member"
	RoleViewer OrganizationRole = "viewer"
)

var (
	ErrUnauthorized           = errors.New("unauthorized: insufficient permissions")
	ErrCannotRemoveSelf       = errors.New("unauthorized: cannot remove yourself from the organization")
	ErrInvalidRole            = errors.New("invalid organization role")
	ErrOwnerRoleRequiresOwner = errors.New("unauthorized: only owners can assign the owner role")
	ErrOwnerRoleProtected     = errors.New("unauthorized: only owners can modify owner memberships")
	ErrCannotRemoveLastOwner  = errors.New("cannot remove the last organization owner")

	orgSettingsValidate         = validator.New()
	marshalOrganizationSettings = json.Marshal
)

type MemberRecord struct {
	UserID         int32            `json:"userId"`
	Email          string           `json:"email"`
	FullName       *string          `json:"fullName"`
	Role           OrganizationRole `json:"role"`
	JoinedAt       time.Time        `json:"joinedAt"`
	OrganizationID int32            `json:"organizationId"`
}

type OrganizationSettings struct {
	AllowPublicProjects bool   `json:"allowPublicProjects"`
	DefaultRole         string `json:"defaultRole" validate:"omitempty,oneof=owner admin member viewer"`
}

type Service interface {
	ListMembers(ctx context.Context, orgID, userID int32) ([]MemberRecord, error)
	GetSettings(ctx context.Context, orgID, userID int32) (*OrganizationSettings, error)
	UpdateSettings(ctx context.Context, orgID, userID int32, settings OrganizationSettings) error
	UpdateMemberRole(ctx context.Context, orgID, targetUserID, actorUserID int32, role OrganizationRole) error
	RemoveMember(ctx context.Context, orgID, targetUserID, actorUserID int32) error
	ExportOrganizationData(ctx context.Context, orgID, userID int32) (any, error)
}

type MembershipStore interface {
	GetMembership(ctx context.Context, input GetMembershipInput) (MembershipRecord, error)
	GetOrganizationMembers(ctx context.Context, orgID int32) ([]OrganizationMemberRecord, error)
	GetOrganizationSettings(ctx context.Context, orgID int32) ([]byte, error)
	UpdateOrganizationSettings(ctx context.Context, input UpdateOrganizationSettingsInput) error
	UpdateMembershipRolePreservingOwners(ctx context.Context, input UpdateMembershipRoleInput) (bool, error)
	DeleteMembershipPreservingOwners(ctx context.Context, input DeleteMembershipInput) (bool, error)
}

type MembershipRecord struct {
	OrganizationID int32
	UserID         int32
	Role           string
}

type OrganizationMemberRecord struct {
	UserID         int32
	Email          string
	FullName       *string
	Role           string
	JoinedAt       time.Time
	OrganizationID int32
}

type GetMembershipInput struct {
	OrganizationID int32
	UserID         int32
}

type UpdateOrganizationSettingsInput struct {
	ID       int32
	Settings []byte
}

type UpdateMembershipRoleInput struct {
	OrganizationID int32
	UserID         int32
	Role           string
}

type DeleteMembershipInput struct {
	OrganizationID int32
	UserID         int32
}

type MembershipService struct {
	store MembershipStore
}

func NewService(store MembershipStore) *MembershipService {
	return &MembershipService{store: store}
}

func (s *MembershipService) ListMembers(ctx context.Context, orgID, userID int32) ([]MemberRecord, error) {
	// Require the caller to be an active member of the org before listing members.
	if _, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         userID,
	}); err != nil {
		slog.Warn("Failed membership check for listing organization members", "orgID", orgID, "userID", userID, "error", err)
		return nil, ErrUnauthorized
	}

	rows, err := s.store.GetOrganizationMembers(ctx, orgID)
	if err != nil {
		slog.Error("Failed to list organization members", "orgID", orgID, "error", err)
		return nil, err
	}

	members := make([]MemberRecord, len(rows))
	for i, row := range rows {
		members[i] = MemberRecord{
			UserID:         row.UserID,
			Email:          row.Email,
			FullName:       row.FullName,
			Role:           OrganizationRole(normalizeRole(row.Role)),
			JoinedAt:       row.JoinedAt,
			OrganizationID: row.OrganizationID,
		}
	}
	return members, nil
}

func (s *MembershipService) GetSettings(ctx context.Context, orgID, userID int32) (*OrganizationSettings, error) {
	if err := s.checkAdminPermission(ctx, orgID, userID); err != nil {
		return nil, err
	}

	settingsData, err := s.store.GetOrganizationSettings(ctx, orgID)
	if err != nil {
		slog.Error("Failed to get organization settings", "orgID", orgID, "error", err)
		return nil, err
	}

	if settingsData == nil {
		return &OrganizationSettings{}, nil
	}

	var settings OrganizationSettings
	if err := json.Unmarshal(settingsData, &settings); err != nil {
		slog.Error("Failed to unmarshal organization settings", "orgID", orgID, "error", err)
		return nil, err
	}
	if err := orgSettingsValidate.Struct(&settings); err != nil {
		slog.Error("Invalid organization settings in database", "orgID", orgID, "error", err)
		return nil, fmt.Errorf("validate organization settings: %w", err)
	}
	return &settings, nil
}

func (s *MembershipService) UpdateSettings(ctx context.Context, orgID, userID int32, settings OrganizationSettings) error {
	if err := s.checkAdminPermission(ctx, orgID, userID); err != nil {
		slog.Warn("Permission check failed for updating settings", "orgID", orgID, "userID", userID, "error", err)
		return err
	}
	if err := orgSettingsValidate.Struct(&settings); err != nil {
		return fmt.Errorf("validate organization settings: %w", err)
	}
	settingsData, err := marshalOrganizationSettings(settings)
	if err != nil {
		slog.Error("Failed to marshal organization settings", "orgID", orgID, "error", err)
		return err
	}

	if err := s.store.UpdateOrganizationSettings(ctx, UpdateOrganizationSettingsInput{
		ID:       orgID,
		Settings: settingsData,
	}); err != nil {
		slog.Error("Failed to update organization settings", "orgID", orgID, "error", err)
		return err
	}
	return nil
}

func (s *MembershipService) UpdateMemberRole(ctx context.Context, orgID, targetUserID, actorUserID int32, role OrganizationRole) error {
	actorMembership, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         actorUserID,
	})
	if err != nil {
		slog.Warn("Failed to get membership for updating member role", "orgID", orgID, "actorUserID", actorUserID, "error", err)
		return ErrUnauthorized
	}
	if !isAdminRole(actorMembership.Role) {
		slog.Warn("Permission check failed for updating member role", "orgID", orgID, "actorUserID", actorUserID)
		return ErrUnauthorized
	}
	normalizedRole, ok := normalizeOrganizationRole(role)
	if !ok {
		return ErrInvalidRole
	}
	if normalizedRole == RoleOwner && OrganizationRole(normalizeRole(actorMembership.Role)) != RoleOwner {
		return ErrOwnerRoleRequiresOwner
	}
	targetMembership, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         targetUserID,
	})
	if err != nil {
		slog.Warn("Failed to get target membership for updating member role", "orgID", orgID, "targetUserID", targetUserID, "error", err)
		return err
	}
	targetIsOwner := OrganizationRole(normalizeRole(targetMembership.Role)) == RoleOwner
	if targetIsOwner && normalizedRole != RoleOwner {
		if OrganizationRole(normalizeRole(actorMembership.Role)) != RoleOwner {
			return ErrOwnerRoleProtected
		}
	}

	input := UpdateMembershipRoleInput{
		OrganizationID: orgID,
		UserID:         targetUserID,
		Role:           strings.ToUpper(string(normalizedRole)),
	}
	updated, err := s.store.UpdateMembershipRolePreservingOwners(ctx, input)
	if err != nil {
		slog.Error("Failed to update membership role", "orgID", orgID, "targetUserID", targetUserID, "error", err)
		return err
	}
	if !updated {
		return ErrCannotRemoveLastOwner
	}
	return nil
}

func normalizeOrganizationRole(role OrganizationRole) (OrganizationRole, bool) {
	normalized := OrganizationRole(normalizeRole(strings.TrimSpace(string(role))))
	switch normalized {
	case RoleOwner, RoleAdmin, RoleMember, RoleViewer:
		return normalized, true
	default:
		return "", false
	}
}

func (s *MembershipService) RemoveMember(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
	if targetUserID == actorUserID {
		slog.Warn("User tried to remove themselves from organization", "orgID", orgID, "userID", targetUserID)
		return ErrCannotRemoveSelf
	}

	actorMembership, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         actorUserID,
	})
	if err != nil {
		slog.Warn("Failed to get membership for removing member", "orgID", orgID, "actorUserID", actorUserID, "error", err)
		return ErrUnauthorized
	}
	if !isAdminRole(actorMembership.Role) {
		slog.Warn("Permission check failed for removing member", "orgID", orgID, "actorUserID", actorUserID)
		return ErrUnauthorized
	}
	targetMembership, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         targetUserID,
	})
	if err != nil {
		slog.Warn("Failed to get target membership for removing member", "orgID", orgID, "targetUserID", targetUserID, "error", err)
		return err
	}
	targetIsOwner := OrganizationRole(normalizeRole(targetMembership.Role)) == RoleOwner
	if targetIsOwner {
		if OrganizationRole(normalizeRole(actorMembership.Role)) != RoleOwner {
			return ErrOwnerRoleProtected
		}
	}

	input := DeleteMembershipInput{
		OrganizationID: orgID,
		UserID:         targetUserID,
	}
	deleted, err := s.store.DeleteMembershipPreservingOwners(ctx, input)
	if err != nil {
		slog.Error("Failed to delete membership", "orgID", orgID, "targetUserID", targetUserID, "error", err)
		return err
	}
	if !deleted {
		return ErrCannotRemoveLastOwner
	}
	return nil
}

func (s *MembershipService) ExportOrganizationData(ctx context.Context, orgID, userID int32) (any, error) {
	if err := s.checkAdminPermission(ctx, orgID, userID); err != nil {
		slog.Warn("Permission check failed for exporting organization data", "orgID", orgID, "userID", userID, "error", err)
		return nil, err
	}
	members, err := s.ListMembers(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	settings, err := s.GetSettings(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"orgId":      orgID,
		"exportedAt": time.Now(),
		"members":    members,
		"settings":   settings,
	}, nil
}

func (s *MembershipService) checkAdminPermission(ctx context.Context, orgID, userID int32) error {
	m, err := s.store.GetMembership(ctx, GetMembershipInput{
		OrganizationID: orgID,
		UserID:         userID,
	})
	if err != nil {
		slog.Warn("Failed to get membership for permission check", "orgID", orgID, "userID", userID, "error", err)
		return ErrUnauthorized
	}

	if isAdminRole(m.Role) {
		return nil
	}

	return ErrUnauthorized
}

func normalizeRole(role string) string {
	return strings.ToLower(role)
}

func isAdminRole(role string) bool {
	switch OrganizationRole(normalizeRole(role)) {
	case RoleOwner, RoleAdmin:
		return true
	case RoleMember, RoleViewer:
		return false
	default:
		return false
	}
}
