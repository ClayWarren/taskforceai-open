package account

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFromDBOrganization(t *testing.T) {
	created := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	workosID := "org_123"

	org := FromDBOrganization(db.Organization{
		ID:                   7,
		Name:                 "Acme",
		Slug:                 "acme",
		CreatedAt:            pgtype.Timestamp{Time: created, Valid: true},
		UpdatedAt:            pgtype.Timestamp{},
		Plan:                 "pro",
		WorkosOrganizationID: &workosID,
		NoTraining:           true,
		Settings:             []byte(`{"allowPublicProjects":true}`),
	})

	assert.Equal(t, int32(7), org.ID)
	assert.Equal(t, "Acme", org.Name)
	assert.Equal(t, &created, org.CreatedAt)
	assert.Nil(t, org.UpdatedAt)
	assert.Equal(t, &workosID, org.WorkosOrganizationID)
	assert.True(t, org.NoTraining)
}

func TestFromDBMembership(t *testing.T) {
	joinedAt := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)

	membership := FromDBMembership(db.Membership{
		ID:             9,
		OrganizationID: 7,
		UserID:         42,
		Role:           db.OrganizationRoleADMIN,
		CreatedAt:      pgtype.Timestamp{Time: joinedAt, Valid: true},
	})

	assert.Equal(t, int32(9), membership.ID)
	assert.Equal(t, int32(7), membership.OrganizationID)
	assert.Equal(t, int32(42), membership.UserID)
	assert.Equal(t, "ADMIN", membership.Role)
	assert.Equal(t, &joinedAt, membership.JoinedAt)
}

func TestFromDBOrganizationMember(t *testing.T) {
	joinedAt := time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC)
	fullName := "Member Example"

	member := FromDBOrganizationMember(db.GetOrganizationMembersRow{
		ID:             9,
		OrganizationID: 7,
		UserID:         42,
		Role:           db.OrganizationRoleMEMBER,
		CreatedAt:      pgtype.Timestamp{Time: joinedAt, Valid: true},
		Email:          "member@example.com",
		FullName:       &fullName,
	})

	assert.Equal(t, int32(9), member.ID)
	assert.Equal(t, int32(7), member.OrganizationID)
	assert.Equal(t, int32(42), member.UserID)
	assert.Equal(t, "MEMBER", member.Role)
	assert.Equal(t, &joinedAt, member.JoinedAt)
	assert.Equal(t, "member@example.com", member.Email)
	assert.Equal(t, &fullName, member.FullName)
}

func TestIsAdminRole(t *testing.T) {
	assert.True(t, IsAdminRole("OWNER"))
	assert.True(t, IsAdminRole("admin"))
	assert.False(t, IsAdminRole("member"))
	assert.False(t, IsAdminRole(""))
}

func TestOrganizationStoreLookupsForwardParametersAndMapResults(t *testing.T) {
	ctx := context.Background()
	queries := &fakeOrganizationQueries{
		org:        db.Organization{ID: 7, Name: "Acme", Slug: "acme"},
		membership: db.Membership{ID: 9, OrganizationID: 7, UserID: 42, Role: db.OrganizationRoleADMIN},
		members: []db.GetOrganizationMembersRow{
			{ID: 10, OrganizationID: 7, UserID: 43, Role: db.OrganizationRoleMEMBER, Email: "member@example.com"},
		},
	}
	store := NewOrganizationStore(queries)

	org, err := store.GetOrganizationByID(ctx, 7)
	require.NoError(t, err)
	assert.Equal(t, int32(7), queries.organizationID)
	assert.Equal(t, "Acme", org.Name)

	membership, err := store.GetMembership(ctx, 7, 42)
	require.NoError(t, err)
	assert.Equal(t, db.GetMembershipParams{OrganizationID: 7, UserID: 42}, queries.membershipParams)
	assert.Equal(t, "ADMIN", membership.Role)

	members, err := store.GetOrganizationMembers(ctx, 7)
	require.NoError(t, err)
	assert.Equal(t, int32(7), queries.membersOrganizationID)
	require.Len(t, members, 1)
	assert.Equal(t, "member@example.com", members[0].Email)
}

func TestOrganizationStoreLookupsPropagateErrors(t *testing.T) {
	expectedErr := errors.New("database unavailable")
	store := NewOrganizationStore(&fakeOrganizationQueries{err: expectedErr})

	_, err := store.GetOrganizationByID(context.Background(), 7)
	require.ErrorIs(t, err, expectedErr)

	_, err = store.GetMembership(context.Background(), 7, 42)
	require.ErrorIs(t, err, expectedErr)

	_, err = store.GetOrganizationMembers(context.Background(), 7)
	assert.ErrorIs(t, err, expectedErr)
}

type fakeOrganizationQueries struct {
	org                   db.Organization
	membership            db.Membership
	members               []db.GetOrganizationMembersRow
	err                   error
	membershipParams      db.GetMembershipParams
	organizationID        int32
	membersOrganizationID int32
}

func (f *fakeOrganizationQueries) GetOrganizationByID(_ context.Context, id int32) (db.Organization, error) {
	f.organizationID = id
	return f.org, f.err
}

func (f *fakeOrganizationQueries) GetMembership(_ context.Context, arg db.GetMembershipParams) (db.Membership, error) {
	f.membershipParams = arg
	return f.membership, f.err
}

func (f *fakeOrganizationQueries) GetOrganizationMembers(_ context.Context, organizationID int32) ([]db.GetOrganizationMembersRow, error) {
	f.membersOrganizationID = organizationID
	return f.members, f.err
}
