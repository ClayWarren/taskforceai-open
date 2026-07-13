package run

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testProgressVersion() int64 {
	return time.Now().UnixMicro()
}

func TestTaskRegistry_Heartbeat_PreservesProgressVersion(t *testing.T) {
	rdb := setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	taskID := "lua-test-task-heartbeat-preserves-progress-version"
	seedLuaProcessingTask(t, rdb, taskID)

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}
	err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, nil)
	require.NoError(t, err)

	beforeRaw, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)
	var before map[string]any
	unmarshalErr := json.Unmarshal([]byte(beforeRaw), &before)
	require.NoError(t, unmarshalErr)
	progressVersionBefore, ok := before["progressVersion"].(float64)
	assert.True(t, ok)
	assert.Greater(t, progressVersionBefore, 0.0)

	err = registry.Heartbeat(context.Background(), taskID)
	require.NoError(t, err)

	afterRaw, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)
	var after map[string]any
	unmarshalErr = json.Unmarshal([]byte(afterRaw), &after)
	require.NoError(t, unmarshalErr)
	progressVersionAfter, ok := after["progressVersion"].(float64)
	assert.True(t, ok)
	assert.Equal(t, progressVersionBefore, progressVersionAfter)
}

func TestTaskRegistry_UpdateProgress_Lua(t *testing.T) {
	rdb := setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	taskID := "lua-test-task"
	seedLuaProcessingTask(t, rdb, taskID)

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}
	budgetUsage := &BudgetUsage{ConsumedUSD: 1.23}

	err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage)
	require.NoError(t, err)

	// Verify results in Redis
	val, err := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, err)

	var updatedTask TaskState
	err = json.Unmarshal([]byte(val), &updatedTask)
	require.NoError(t, err)

	assert.Equal(t, StatusProcessing, updatedTask.Status)
	assert.NotNil(t, updatedTask.AgentStatuses)
	assert.NotNil(t, updatedTask.ToolEvents)
	assert.NotNil(t, updatedTask.BudgetUsage)
	assert.Equal(t, 1.23, updatedTask.BudgetUsage.ConsumedUSD)
}

func TestTaskRegistry_UpdateProgress_Lua_PreservesToolEventsOnStatusOnlyUpdate(t *testing.T) {
	rdb := setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	taskID := "lua-test-task-tool-events-null"
	seedLuaProcessingTask(t, rdb, taskID)

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}

	err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, nil)
	require.NoError(t, err)

	err = registry.UpdateProgress(taskID, agentStatuses, nil, nil)
	require.NoError(t, err)

	val, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)

	var updatedTask TaskState
	unmarshalErr := json.Unmarshal([]byte(val), &updatedTask)
	require.NoError(t, unmarshalErr)
	assert.NotNil(t, updatedTask.AgentStatuses)
	assert.NotNil(t, updatedTask.ToolEvents)
}

func TestTaskRegistry_UpdateProgress_Lua_PreservesAgentStatusesOnToolOnlyUpdate(t *testing.T) {
	rdb := setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	taskID := "lua-test-task-agent-statuses-null"
	seedLuaProcessingTask(t, rdb, taskID)

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}

	err := registry.UpdateProgress(taskID, agentStatuses, nil, nil)
	require.NoError(t, err)

	err = registry.UpdateProgress(taskID, nil, toolEvents, nil)
	require.NoError(t, err)

	val, getErr := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, getErr)

	var updatedTask TaskState
	unmarshalErr := json.Unmarshal([]byte(val), &updatedTask)
	require.NoError(t, unmarshalErr)
	assert.NotNil(t, updatedTask.AgentStatuses)
	assert.NotNil(t, updatedTask.ToolEvents)
}

func TestTaskRegistry_UpdateProgress_Lua_ClearsBudgetUsageOnNull(t *testing.T) {
	rdb := setupLuaMiniredis(t)
	registry := &TaskRegistry{}
	taskID := "lua-test-task-budget-clear"
	seedLuaProcessingTask(t, rdb, taskID)

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}

	initialBudgetUsage := &BudgetUsage{ConsumedUSD: 1.23}
	err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, initialBudgetUsage)
	require.NoError(t, err)

	err = registry.UpdateProgress(taskID, agentStatuses, toolEvents, nil)
	require.NoError(t, err)

	val, err := rdb.Get(context.Background(), "task:"+taskID).Result()
	require.NoError(t, err)

	var updatedTask TaskState
	err = json.Unmarshal([]byte(val), &updatedTask)
	require.NoError(t, err)
	assert.Nil(t, updatedTask.BudgetUsage)
}
