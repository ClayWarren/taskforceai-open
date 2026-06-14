package pkg

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContractsJSON(t *testing.T) {
	t.Run("RunRequest", func(t *testing.T) {
		budget := 12.5
		req := RunRequest{
			Prompt:        "Hello",
			Demo:          true,
			AttachmentIDs: []string{"u:1:att-1"},
			Budget:        &budget,
			RoleModels:    map[string]string{"research": "openai/gpt-5.5"},
		}
		data, err := json.Marshal(req)
		require.NoError(t, err)
		assert.Contains(t, string(data), `"prompt":"Hello"`)
		assert.Contains(t, string(data), `"demo":true`)
		assert.Contains(t, string(data), `"attachment_ids":["u:1:att-1"]`)
		assert.Contains(t, string(data), `"budget":12.5`)
		assert.Contains(t, string(data), `"role_models":{"research":"openai/gpt-5.5"}`)
	})

	t.Run("AuthenticatedUser", func(t *testing.T) {
		impersonatorID := "imp-1"
		user := AuthenticatedUser{
			Email:                "alice@example.com",
			Plan:                 PlanPro,
			MemoryEnabled:        true,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
			NotificationsEnabled: true,
			QuickModeEnabled:     true,
			TrustLayerEnabled:    true,
			ImpersonatorID:       &impersonatorID,
		}
		data, err := json.Marshal(user)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"email\":\"alice@example.com\"")
		assert.Contains(t, string(data), "\"plan\":\"pro\"")
		assert.Contains(t, string(data), "\"memory_enabled\":true")
		assert.Contains(t, string(data), "\"web_search_enabled\":true")
		assert.Contains(t, string(data), "\"code_execution_enabled\":true")
		assert.Contains(t, string(data), "\"notifications_enabled\":true")
		assert.Contains(t, string(data), "\"quick_mode_enabled\":true")
		assert.Contains(t, string(data), "\"trust_layer_enabled\":true")
		assert.Contains(t, string(data), "\"impersonator_id\":\"imp-1\"")
	})

	t.Run("RunResponse", func(t *testing.T) {
		status := "queued"
		resp := RunResponse{
			TaskID: "task-123",
			Status: &status,
		}
		data, err := json.Marshal(resp)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"task_id\":\"task-123\"")
		assert.Contains(t, string(data), "\"status\":\"queued\"")
	})

	t.Run("ConversationList", func(t *testing.T) {
		list := ConversationList{
			Conversations: []ConversationSummary{
				{ID: 1, UserInput: "hi", Result: "bye"},
			},
			Total: 1,
		}
		data, err := json.Marshal(list)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"user_input\":\"hi\"")
	})

	t.Run("ModelSelectorResponse", func(t *testing.T) {
		resp := ModelSelectorResponse{
			Enabled: true,
			Options: []ModelOptionSummary{
				{ID: "m1", Label: "M1", Badge: "B1"},
			},
		}
		data, err := json.Marshal(resp)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"enabled\":true")
	})

	t.Run("PushTokenRegistration", func(t *testing.T) {
		reg := PushTokenRegistration{
			Token:    "t1",
			Platform: PlatformIOS,
		}
		data, err := json.Marshal(reg)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"platform\":\"ios\"")
	})
}
