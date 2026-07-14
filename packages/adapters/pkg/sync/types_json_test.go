package sync

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSyncWireTypesUseCanonicalSnakeCase(t *testing.T) {
	t.Run("pull request", func(t *testing.T) {
		organizationID := 7
		payload, err := json.Marshal(SyncPullRequest{
			LastSyncVersion: 12,
			DeviceID:        "device-1",
			Limit:           5,
			OrganizationID:  &organizationID,
		})
		require.NoError(t, err)
		require.JSONEq(t, `{
			"last_sync_version": 12,
			"device_id": "device-1",
			"limit": 5,
			"organization_id": 7
		}`, string(payload))
		require.NotContains(t, string(payload), "lastSyncVersion")
	})

	t.Run("pull response", func(t *testing.T) {
		var response SyncPullResponse
		err := json.Unmarshal([]byte(`{
			"conversations": [{
				"id": 42,
				"timestamp": "2026-07-14T00:00:00Z",
				"user_input": "prompt",
				"project_id": 9,
				"agent_count": 2,
				"sync_version": 3,
				"last_synced_at": "2026-07-14T00:00:00Z",
				"is_deleted": false,
				"updated_at": "2026-07-14T00:00:00Z"
			}],
			"messages": [],
			"deletions": [],
			"latest_version": 3,
			"has_more": true,
			"state_hash": "1:0"
		}`), &response)
		require.NoError(t, err)
		require.Equal(t, 3, response.LatestVersion)
		require.True(t, response.HasMore)
		require.Equal(t, "1:0", response.StateHash)
		require.Len(t, response.Conversations, 1)
		require.Equal(t, "prompt", response.Conversations[0].UserInput)
		require.NotNil(t, response.Conversations[0].ProjectID)
		require.Equal(t, 9, *response.Conversations[0].ProjectID)
	})

	t.Run("push response", func(t *testing.T) {
		payload, err := json.Marshal(SyncPushResponse{
			Success:    true,
			Version:    8,
			Accepted:   []string{"conversation:local-1"},
			NewVersion: 8,
			ConversationIDMappings: map[string]int{
				"local-1": 42,
			},
			Conflicts: []ConflictRecord{{
				Type:          "conversation",
				ID:            "42",
				Reason:        "server_newer",
				ServerVersion: 8,
				ClientVersion: 7,
			}},
		})
		require.NoError(t, err)

		var decoded map[string]any
		require.NoError(t, json.Unmarshal(payload, &decoded))
		require.Equal(t, float64(8), decoded["new_version"])
		require.Contains(t, decoded, "conversation_id_mappings")
		conflicts := decoded["conflicts"].([]any)
		conflict := conflicts[0].(map[string]any)
		require.Equal(t, float64(8), conflict["server_version"])
		require.Equal(t, float64(7), conflict["client_version"])
	})
}
