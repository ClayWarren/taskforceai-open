package run

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskRegistry_UpdateProgress_Lua_InvalidProgressVersion(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	testCases := []struct {
		name            string
		progressVersion any
	}{
		{name: "zero", progressVersion: 0},
		{name: "negative", progressVersion: -1},
		{name: "non-integer", progressVersion: 1.5},
		{name: "non-number", progressVersion: "not-a-number"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			taskID := "lua-test-task-invalid-progress-version-" + tc.name
			seedLuaProcessingTask(t, rdb, taskID)

			_, evalErr := rdb.Eval(
				context.Background(),
				updateProgressScript,
				[]string{"task:" + taskID},
				"[]",
				"[]",
				"null",
				time.Now().Unix(),
				int(TaskTTL.Seconds()),
				tc.progressVersion,
			).Result()
			assert.EqualError(t, evalErr, "invalid progressVersion")
		})
	}
}

func TestTaskState_UnmarshalProgressVersionExponent(t *testing.T) {
	var task TaskState
	err := json.Unmarshal([]byte(`{
		"taskId": "task-progress-version",
		"status": "processing",
		"userId": 1,
		"options": {},
		"progressVersion": 1.7807085519859e+15
	}`), &task)

	require.NoError(t, err)
	assert.Equal(t, int64(1780708551985900), task.ProgressVersion)
}

func TestTaskState_UnmarshalProgressVersionRejectsFractional(t *testing.T) {
	var task TaskState
	err := json.Unmarshal([]byte(`{"taskId":"task-progress-version","progressVersion":123.5}`), &task)

	assert.EqualError(t, err, "progressVersion: not an integer")
}

func TestParseJSONInt64PlainIntegerBounds(t *testing.T) {
	testCases := []struct {
		name    string
		raw     string
		want    int64
		wantErr string
	}{
		{name: "max", raw: `9223372036854775807`, want: 9223372036854775807},
		{name: "min", raw: `-9223372036854775808`, want: -9223372036854775808},
		{name: "positive overflow", raw: `9223372036854775808`, wantErr: "integer out of range"},
		{name: "negative overflow", raw: `-9223372036854775809`, wantErr: "integer out of range"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseJSONInt64(json.RawMessage(tc.raw))
			if tc.wantErr != "" {
				assert.EqualError(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

var benchmarkTaskState TaskState

func BenchmarkTaskStateUnmarshalProgressVersion(b *testing.B) {
	raw := []byte(`{
		"taskId": "task-progress-version",
		"status": "processing",
		"userId": 7,
		"prompt": "prompt",
		"modelId": "gpt-5.6-sol",
		"options": {},
		"updatedAt": 1780708551,
		"progressVersion": 1780708551985900,
		"agentStatuses": [{"agentId": 0, "status": "RUNNING"}],
		"toolEvents": [{"toolName": "search_web", "success": true}]
	}`)

	b.ReportAllocs()
	for b.Loop() {
		var task TaskState
		if err := json.Unmarshal(raw, &task); err != nil {
			b.Fatal(err)
		}
		benchmarkTaskState = task
	}
}

func TestTaskRegistry_UpdateProgress_Lua_NotFound(t *testing.T) {
	setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	err := registry.UpdateProgress("non-existent", nil, nil, nil)
	// Should return nil (no error) as per implementation for missing tasks
	assert.NoError(t, err)
}

func TestTaskRegistry_UpdateProgress_Lua_StaleProgressVersion(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	taskID := "lua-test-task-stale-progress-version"
	originalUpdatedAt := time.Now().Unix()
	task := &TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UpdatedAt: originalUpdatedAt,
	}
	data, marshalErr := json.Marshal(task)
	assert.NoError(t, marshalErr)
	assert.NoError(t, rdb.Set(context.Background(), "task:"+taskID, data, time.Hour).Err())

	firstProgressVersion := originalUpdatedAt*1_000_000 + 500
	_, err := rdb.Eval(
		context.Background(),
		updateProgressScript,
		[]string{"task:" + taskID},
		"[]",
		"[]",
		"null",
		originalUpdatedAt,
		int(TaskTTL.Seconds()),
		firstProgressVersion,
	).Result()
	require.NoError(t, err)

	_, err = rdb.Eval(
		context.Background(),
		updateProgressScript,
		[]string{"task:" + taskID},
		"[]",
		"[]",
		"null",
		originalUpdatedAt,
		int(TaskTTL.Seconds()),
		firstProgressVersion-1,
	).Result()
	assert.EqualError(t, err, "stale progressVersion")
}

func TestTaskRegistry_UpdateProgress_Lua_StaleUpdatedAt(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	taskID := "lua-test-task-stale-updated-at"
	originalUpdatedAt := time.Now().Unix()
	task := &TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UpdatedAt: originalUpdatedAt,
	}
	data, marshalErr := json.Marshal(task)
	assert.NoError(t, marshalErr)
	assert.NoError(t, rdb.Set(context.Background(), "task:"+taskID, data, time.Hour).Err())

	_, err := rdb.Eval(
		context.Background(),
		updateProgressScript,
		[]string{"task:" + taskID},
		"[]",
		"[]",
		"null",
		originalUpdatedAt-1,
		int(TaskTTL.Seconds()),
		originalUpdatedAt*1_000_000+1,
	).Result()
	require.EqualError(t, err, "stale updatedAt")

	val, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)

	var unchangedTask TaskState
	unmarshalErr := json.Unmarshal([]byte(val), &unchangedTask)
	require.NoError(t, unmarshalErr)
	assert.Equal(t, originalUpdatedAt, unchangedTask.UpdatedAt)
	assert.Nil(t, unchangedTask.AgentStatuses)
}

func TestTaskRegistry_UpdateProgress_Lua_StaleUpdatedAtDoesNotFallbackToLegacy(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	registry := &TaskRegistry{}
	taskID := "lua-test-task-stale-no-fallback"
	futureUpdatedAt := time.Now().Add(time.Minute).Unix()
	task := &TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UpdatedAt: futureUpdatedAt,
	}
	data, marshalErr := json.Marshal(task)
	assert.NoError(t, marshalErr)
	assert.NoError(t, rdb.Set(context.Background(), "task:"+taskID, data, time.Hour).Err())

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}
	err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, nil)
	require.NoError(t, err)

	val, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)

	var unchangedTask TaskState
	unmarshalErr := json.Unmarshal([]byte(val), &unchangedTask)
	require.NoError(t, unmarshalErr)
	assert.Equal(t, futureUpdatedAt, unchangedTask.UpdatedAt)
	assert.Nil(t, unchangedTask.AgentStatuses)
	assert.Nil(t, unchangedTask.ToolEvents)
}

func TestTaskRegistry_UpdateProgress_Lua_ValidationErrorDoesNotFallbackToLegacy(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	registry := &TaskRegistry{}
	taskID := "lua-test-task-validation-no-fallback"
	task := &TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UpdatedAt: time.Now().Unix(),
	}
	data, marshalErr := json.Marshal(task)
	assert.NoError(t, marshalErr)
	assert.NoError(t, rdb.Set(context.Background(), "task:"+taskID, data, time.Hour).Err())

	err := registry.UpdateProgress(taskID, "invalid-shape", []map[string]any{}, nil)
	require.ErrorContains(t, err, "update_progress validation failed")
	require.ErrorContains(t, err, "invalid agentStatuses shape")

	val, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)

	var unchangedTask TaskState
	unmarshalErr := json.Unmarshal([]byte(val), &unchangedTask)
	require.NoError(t, unmarshalErr)
	assert.Nil(t, unchangedTask.AgentStatuses)
	assert.Nil(t, unchangedTask.ToolEvents)
}

func TestTaskRegistry_UpdateProgress_Lua_WrongStatus(t *testing.T) {
	rdb := setupLuaMiniredis(t)

	registry := &TaskRegistry{}
	taskID := "lua-test-task-completed"
	task := &TaskState{
		TaskID:    taskID,
		Status:    StatusCompleted,
		UpdatedAt: time.Now().Unix(),
	}
	data, _ := json.Marshal(task)
	_ = rdb.Set(context.Background(), "task:"+taskID, data, time.Hour).Err()

	err := registry.UpdateProgress(taskID, nil, nil, nil)
	require.NoError(t, err)

	// Verify nothing changed
	val, _ := rdb.Get(context.Background(), "task:"+taskID).Result()
	var finalTask TaskState
	_ = json.Unmarshal([]byte(val), &finalTask)
	assert.Equal(t, StatusCompleted, finalTask.Status)
	assert.Nil(t, finalTask.AgentStatuses)
}

func TestTaskRegistry_UpdateProgress_MarshalAgentStatusesError(t *testing.T) {
	registry := &TaskRegistry{}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}
	err := registry.UpdateProgress("lua-test-task-marshal-error", make(chan int), toolEvents, nil)
	assert.ErrorContains(t, err, "marshal agentStatuses")
}
