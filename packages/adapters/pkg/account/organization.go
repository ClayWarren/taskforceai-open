package account

import (
	"context"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/db"
)

const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleViewer = "viewer"
)

type OrganizationQuerySource interface {
	GetOrganizationByID(ctx context.Context, id int32) (db.Organization, error)
	GetMembership(ctx context.Context, arg db.GetMembershipParams) (db.Membership, error)
	GetOrganizationMembers(ctx context.Context, organizationID int32) ([]db.GetOrganizationMembersRow, error)
}

type OrganizationStore struct {
	q OrganizationQuerySource
}

type Organization struct {
	CreatedAt            *time.Time
	UpdatedAt            *time.Time
	Domain               *string
	SubscriptionID       *string
	SubscriptionStatus   *string
	CustomerID           *string
	WorkosOrganizationID *string
	ID                   int32
	Name                 string
	Slug                 string
	Plan                 string
	Settings             []byte
	NoTraining           bool
}

type Membership struct {
	JoinedAt       *time.Time
	ID             int32
	OrganizationID int32
	UserID         int32
	Role           string
}

type OrganizationMember struct {
	JoinedAt       *time.Time
	FullName       *string
	ID             int32
	OrganizationID int32
	UserID         int32
	Email          string
	Role           string
}

func NewOrganizationStore(q OrganizationQuerySource) OrganizationStore {
	return OrganizationStore{q: q}
}

func (s OrganizationStore) GetOrganizationByID(ctx context.Context, id int32) (Organization, error) {
	org, err := s.q.GetOrganizationByID(ctx, id)
	if err != nil {
		return Organization{}, err
	}
	return FromDBOrganization(org), nil
}

func (s OrganizationStore) GetMembership(ctx context.Context, organizationID, userID int32) (Membership, error) {
	membership, err := s.q.GetMembership(ctx, db.GetMembershipParams{
		OrganizationID: organizationID,
		UserID:         userID,
	})
	if err != nil {
		return Membership{}, err
	}
	return FromDBMembership(membership), nil
}

func (s OrganizationStore) GetOrganizationMembers(ctx context.Context, organizationID int32) ([]OrganizationMember, error) {
	rows, err := s.q.GetOrganizationMembers(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	return collections.Map(rows, FromDBOrganizationMember), nil
}

func FromDBOrganization(org db.Organization) Organization {
	return Organization{
		ID:                   org.ID,
		Name:                 org.Name,
		Slug:                 org.Slug,
		Domain:               org.Domain,
		CreatedAt:            timestamp(org.CreatedAt),
		UpdatedAt:            timestamp(org.UpdatedAt),
		Plan:                 org.Plan,
		SubscriptionID:       org.SubscriptionID,
		SubscriptionStatus:   org.SubscriptionStatus,
		CustomerID:           org.CustomerID,
		WorkosOrganizationID: org.WorkosOrganizationID,
		NoTraining:           org.NoTraining,
		Settings:             org.Settings,
	}
}

func FromDBMembership(membership db.Membership) Membership {
	return Membership{
		ID:             membership.ID,
		OrganizationID: membership.OrganizationID,
		UserID:         membership.UserID,
		Role:           string(membership.Role),
		JoinedAt:       timestamp(membership.CreatedAt),
	}
}

func FromDBOrganizationMember(row db.GetOrganizationMembersRow) OrganizationMember {
	return OrganizationMember{
		ID:             row.ID,
		OrganizationID: row.OrganizationID,
		UserID:         row.UserID,
		Role:           string(row.Role),
		JoinedAt:       timestamp(row.CreatedAt),
		Email:          row.Email,
		FullName:       row.FullName,
	}
}

func NormalizeRole(role string) string {
	return strings.ToLower(role)
}

func IsAdminRole(role string) bool {
	normalized := NormalizeRole(role)
	return normalized == RoleOwner || normalized == RoleAdmin
}
