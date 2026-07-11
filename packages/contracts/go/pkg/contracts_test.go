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
			RoleModels:    map[string]string{"research": "openai/gpt-5.6-sol"},
		}
		data, err := json.Marshal(req)
		require.NoError(t, err)
		assert.Contains(t, string(data), `"prompt":"Hello"`)
		assert.Contains(t, string(data), `"demo":true`)
		assert.Contains(t, string(data), `"attachment_ids":["u:1:att-1"]`)
		assert.Contains(t, string(data), `"budget":12.5`)
		assert.Contains(t, string(data), `"role_models":{"research":"openai/gpt-5.6-sol"}`)
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
			MFAEnabled:           true,
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
		assert.Contains(t, string(data), "\"mfa_enabled\":true")
		assert.Contains(t, string(data), "\"impersonator_id\":\"imp-1\"")
	})

	t.Run("RunResponse", func(t *testing.T) {
		conversationID := int32(42)
		resp := RunResponse{
			TaskID:         "task-123",
			Status:         "completed",
			ConversationID: &conversationID,
			TraceID:        "trace-123",
		}
		data, err := json.Marshal(resp)
		require.NoError(t, err)
		assert.Contains(t, string(data), "\"task_id\":\"task-123\"")
		assert.Contains(t, string(data), "\"status\":\"completed\"")
		assert.Contains(t, string(data), "\"conversation_id\":42")
		assert.Contains(t, string(data), "\"trace_id\":\"trace-123\"")
	})

	t.Run("RunResponseDecodesEngineInlineExecutionShape", func(t *testing.T) {
		var resp RunResponse
		err := json.Unmarshal([]byte(`{
			"task_id":"task-123",
			"status":"completed",
			"result":"done",
			"conversation_id":42,
			"trace_id":"trace-123"
		}`), &resp)
		require.NoError(t, err)
		assert.Equal(t, "task-123", resp.TaskID)
		assert.Equal(t, "completed", resp.Status)
		if assert.NotNil(t, resp.ConversationID) {
			assert.Equal(t, int32(42), *resp.ConversationID)
		}
		if assert.NotNil(t, resp.Result) {
			assert.Equal(t, "done", *resp.Result)
		}
		assert.Equal(t, "trace-123", resp.TraceID)
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
}
