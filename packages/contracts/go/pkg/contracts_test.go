package pkg

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func pointer[T any](value T) *T { return &value }

func assertJSONContains(t *testing.T, value any, wants ...string) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range wants {
		if !strings.Contains(string(data), want) {
			t.Errorf("JSON %s does not contain %s", data, want)
		}
	}
}

func TestContractsEncodeJSON(t *testing.T) {
	t.Run("RunRequest", func(t *testing.T) {
		request := RunRequest{
			Prompt:        "Hello",
			Demo:          true,
			AttachmentIDs: []string{"u:1:att-1"},
			Budget:        pointer(12.5),
			RoleModels:    map[string]string{"research": "openai/gpt-5.6-sol"},
		}
		assertJSONContains(t, request,
			`"prompt":"Hello"`, `"demo":true`, `"attachment_ids":["u:1:att-1"]`,
			`"budget":12.5`, `"role_models":{"research":"openai/gpt-5.6-sol"}`,
		)
	})

	t.Run("AuthenticatedUser", func(t *testing.T) {
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
			ImpersonatorID:       pointer("imp-1"),
		}
		assertJSONContains(t, user,
			`"email":"alice@example.com"`, `"plan":"pro"`, `"memory_enabled":true`,
			`"web_search_enabled":true`, `"code_execution_enabled":true`, `"notifications_enabled":true`,
			`"quick_mode_enabled":true`, `"trust_layer_enabled":true`, `"mfa_enabled":true`,
			`"impersonator_id":"imp-1"`,
		)
	})

	t.Run("RunResponse", func(t *testing.T) {
		response := RunResponse{
			TaskID:         "task-123",
			Status:         "completed",
			ConversationID: pointer[int32](42),
			TraceID:        "trace-123",
		}
		assertJSONContains(t, response,
			`"task_id":"task-123"`, `"status":"completed"`,
			`"conversation_id":42`, `"trace_id":"trace-123"`,
		)
	})

	t.Run("ModelSelectorResponse", func(t *testing.T) {
		response := ModelSelectorResponse{
			Enabled: true,
			Options: []ModelOptionSummary{{ID: "m1", Label: "M1", Badge: "B1"}},
		}
		assertJSONContains(t, response, `"enabled":true`)
	})
}

func TestRunResponseDecodesEngineInlineExecutionShape(t *testing.T) {
	var got RunResponse
	if err := json.Unmarshal([]byte(`{"task_id":"task-123","status":"completed","result":"done","conversation_id":42,"trace_id":"trace-123"}`), &got); err != nil {
		t.Fatal(err)
	}
	want := RunResponse{
		TaskID: "task-123", Status: "completed", Result: pointer("done"),
		ConversationID: pointer[int32](42), TraceID: "trace-123",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("decoded response = %#v, want %#v", got, want)
	}
}
