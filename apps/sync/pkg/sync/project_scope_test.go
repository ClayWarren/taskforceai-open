package sync

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestValidateConversationProjectScopesRejectsUnauthorizedProjects(t *testing.T) {
	organizationID := int32(7)
	tests := []struct {
		name           string
		projectID      int32
		organizationID *int32
	}{
		{name: "cross-user personal project", projectID: 40},
		{name: "missing personal project", projectID: 404},
		{name: "cross-organization project", projectID: 41, organizationID: &organizationID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			repo := new(MockSyncRepository)
			repo.On("ProjectExistsInScope", ctx, tt.projectID, "123", tt.organizationID).Return(false, nil).Once()

			err := validateConversationProjectScopes(ctx, repo, "123", tt.organizationID, []ConversationSyncPayload{
				{ProjectID: &tt.projectID},
			})

			require.ErrorIs(t, err, ErrProjectAccessDenied)
			repo.AssertExpectations(t)
		})
	}
}

func TestValidateConversationProjectScopesAllowsOwnedProjectAndDeduplicatesLookups(t *testing.T) {
	ctx := context.Background()
	repo := new(MockSyncRepository)
	projectID := int32(17)
	repo.On("ProjectExistsInScope", ctx, projectID, "123", (*int32)(nil)).Return(true, nil).Once()

	err := validateConversationProjectScopes(ctx, repo, "123", nil, []ConversationSyncPayload{
		{ProjectID: &projectID},
		{ProjectID: &projectID},
		{},
	})

	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestValidateConversationProjectScopesAllowsOwnedOrganizationProject(t *testing.T) {
	ctx := context.Background()
	repo := new(MockSyncRepository)
	projectID := int32(23)
	organizationID := int32(7)
	repo.On("ProjectExistsInScope", ctx, projectID, "123", &organizationID).Return(true, nil).Once()

	err := validateConversationProjectScopes(ctx, repo, "123", &organizationID, []ConversationSyncPayload{{ProjectID: &projectID}})

	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestValidateConversationProjectScopesPropagatesLookupFailure(t *testing.T) {
	ctx := context.Background()
	repo := new(MockSyncRepository)
	projectID := int32(17)
	repo.On("ProjectExistsInScope", ctx, projectID, "123", mock.Anything).Return(false, errors.New("database unavailable")).Once()

	err := validateConversationProjectScopes(ctx, repo, "123", nil, []ConversationSyncPayload{{ProjectID: &projectID}})

	require.ErrorContains(t, err, "database unavailable")
	require.NotErrorIs(t, err, ErrProjectAccessDenied)
	repo.AssertExpectations(t)
}
