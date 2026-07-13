package run

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskRegistry_UpdateProgress_Lua_EvalValidationErrors(t *testing.T) {
	zeroTTL := 0

	cases := []struct {
		name            string
		seedPayload     any
		eval            luaUpdateProgressEvalInput
		wantErr         string
		wantErrContains string
	}{
		{
			name: "corrupt progressVersion not integer",
			seedPayload: map[string]any{
				"taskId":          "lua-eval-corrupt-progress-version",
				"status":          string(StatusProcessing),
				"updatedAt":       time.Now().Unix(),
				"progressVersion": 123.5,
			},
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null"},
			wantErr: "corrupt task data",
		},
		{
			name:        "corrupt root shape",
			seedPayload: "123",
			eval:        luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null"},
			wantErr:     "corrupt task data",
		},
		{
			name: "corrupt updatedAt not integer",
			seedPayload: map[string]any{
				"taskId":    "lua-eval-corrupt-updated-at",
				"status":    string(StatusProcessing),
				"updatedAt": 123.5,
			},
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null"},
			wantErr: "corrupt task data",
		},
		{
			name:    "invalid agentStatuses empty object",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "{}", toolEvents: "[]", budgetUsage: "null"},
			wantErr: "invalid agentStatuses shape",
		},
		{
			name:    "invalid agentStatuses item shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[1]", toolEvents: "[]", budgetUsage: "null"},
			wantErr: "invalid agentStatuses shape",
		},
		{
			name:    "invalid agentStatuses shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: `"invalid-shape"`, toolEvents: "[]", budgetUsage: "null"},
			wantErr: "invalid agentStatuses shape",
		},
		{
			name:    "invalid args arity",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null", shortArgs: true},
			wantErr: "invalid args",
		},
		{
			name:    "invalid budgetUsage array shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "[]"},
			wantErr: "invalid budgetUsage shape",
		},
		{
			name:            "invalid budgetUsage json",
			eval:            luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "foo"},
			wantErrContains: "invalid budgetUsage json:",
		},
		{
			name:    "invalid budgetUsage shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: `"invalid-budget"`},
			wantErr: "invalid budgetUsage shape",
		},
		{
			name:    "invalid ttl",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null", ttlSeconds: &zeroTTL},
			wantErr: "invalid ttl",
		},
		{
			name:    "invalid toolEvents empty object",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "{}", budgetUsage: "null"},
			wantErr: "invalid toolEvents shape",
		},
		{
			name:    "invalid toolEvents item shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[1]", budgetUsage: "null"},
			wantErr: "invalid toolEvents shape",
		},
		{
			name:    "invalid toolEvents shape",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: `{"unexpected":"shape"}`, budgetUsage: "null"},
			wantErr: "invalid toolEvents shape",
		},
		{
			name:    "invalid updatedAt",
			eval:    luaUpdateProgressEvalInput{agentStatuses: "[]", toolEvents: "[]", budgetUsage: "null", updatedAt: "not-a-number"},
			wantErr: "invalid updatedAt",
		},
	}

	rdb := setupLuaMiniredis(t)

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			taskID := "lua-eval-" + tc.name
			payload := tc.seedPayload
			if payload == nil {
				payload = &TaskState{
					TaskID:    taskID,
					Status:    StatusProcessing,
					UpdatedAt: time.Now().Unix(),
				}
			} else if m, ok := payload.(map[string]any); ok {
				m["taskId"] = taskID
				payload = m
			}
			seedLuaTaskRedis(t, rdb, taskID, payload)

			err := runLuaUpdateProgressEval(t, rdb, taskID, tc.eval)
			if tc.wantErr != "" {
				assert.EqualError(t, err, tc.wantErr)
				return
			}
			require.Error(t, err)
			assert.ErrorContains(t, err, tc.wantErrContains)
		})
	}
}
