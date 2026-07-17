package sync

import (
	"testing"

	domainsync "github.com/TaskForceAI/go-sync/pkg/sync"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

//go:fix inline
func ptrInt32(value int32) *int32 {
	return new(value)
}

func TestNormalizePushOrganizationScope_RejectsConversationOrgWithoutTopLevel(t *testing.T) {
	req := &SyncPushRequest{
		Conversations: []domainsync.ConversationSyncPayload{
			{OrganizationID: new(int32(2))},
		},
	}

	err := normalizePushOrganizationScope(req)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires top-level organizationId")
}

func TestNormalizePushOrganizationScope_RejectsConversationOrgMismatch(t *testing.T) {
	req := &SyncPushRequest{
		OrganizationID: new(int32(2)),
		Conversations: []domainsync.ConversationSyncPayload{
			{OrganizationID: new(int32(3))},
		},
	}

	err := normalizePushOrganizationScope(req)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must match top-level organizationId")
}

func TestNormalizePushOrganizationScope_AssignsTopLevelOrgToNilConversationOrg(t *testing.T) {
	topLevelOrgID := ptrInt32(7)
	req := &SyncPushRequest{
		OrganizationID: topLevelOrgID,
		Conversations: []domainsync.ConversationSyncPayload{
			{OrganizationID: nil},
		},
	}

	err := normalizePushOrganizationScope(req)
	require.NoError(t, err)
	require.NotNil(t, req.Conversations[0].OrganizationID)
	assert.Equal(t, int32(7), *req.Conversations[0].OrganizationID)
	assert.Same(t, topLevelOrgID, req.Conversations[0].OrganizationID)
}

func TestNormalizePushOrganizationScope_RepointsMatchingConversationOrgToTopLevel(t *testing.T) {
	topLevelOrgID := ptrInt32(9)
	matchingConversationOrgID := ptrInt32(9)
	req := &SyncPushRequest{
		OrganizationID: topLevelOrgID,
		Conversations: []domainsync.ConversationSyncPayload{
			{OrganizationID: matchingConversationOrgID},
		},
	}

	err := normalizePushOrganizationScope(req)
	require.NoError(t, err)
	require.NotNil(t, req.Conversations[0].OrganizationID)
	assert.Same(t, topLevelOrgID, req.Conversations[0].OrganizationID)
}

func TestNormalizePushOrganizationScope_AllowsNoOrganizationScope(t *testing.T) {
	req := &SyncPushRequest{
		Conversations: []domainsync.ConversationSyncPayload{
			{OrganizationID: nil},
		},
	}

	err := normalizePushOrganizationScope(req)
	require.NoError(t, err)
	assert.Nil(t, req.OrganizationID)
	assert.Nil(t, req.Conversations[0].OrganizationID)
}
