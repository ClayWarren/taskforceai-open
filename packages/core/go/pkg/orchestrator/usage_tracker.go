package orchestrator

import (
	"encoding/json"
	"sync"

	"github.com/TaskForceAI/core/pkg/agent"
)

type UsageTracker struct {
	toolUsage            []agent.ToolEvent
	toolUsageByID        map[string]int
	toolUsageLegacyKeys  []toolInvocationKey
	toolUsageByLegacyKey map[toolInvocationKey]int
	toolUsageLegacyDirty bool
	tokenUsage           []TokenUsageRecord
	listeners            map[uint64]func(agent.ToolEvent, []agent.ToolEvent)
	nextID               uint64
	mu                   sync.RWMutex
}

type toolInvocationKey struct {
	agentID    int
	agentLabel string
	toolName   string
	arguments  string
}

func NewUsageTracker() *UsageTracker {
	return &UsageTracker{
		toolUsage:            make([]agent.ToolEvent, 0),
		toolUsageByID:        make(map[string]int),
		toolUsageLegacyKeys:  make([]toolInvocationKey, 0),
		toolUsageByLegacyKey: make(map[toolInvocationKey]int),
		tokenUsage:           make([]TokenUsageRecord, 0),
		listeners:            make(map[uint64]func(agent.ToolEvent, []agent.ToolEvent)),
	}
}

func (u *UsageTracker) RecordToolUsage(event agent.ToolEvent) {
	u.mu.Lock()
	u.upsertToolEvent(event)
	if len(u.listeners) == 0 {
		u.mu.Unlock()
		return
	}
	currentUsage := make([]agent.ToolEvent, len(u.toolUsage))
	copy(currentUsage, u.toolUsage)

	listeners := make([]func(agent.ToolEvent, []agent.ToolEvent), 0, len(u.listeners))
	for _, l := range u.listeners {
		listeners = append(listeners, l)
	}
	u.mu.Unlock()

	for _, l := range listeners {
		l(event, currentUsage)
	}
}

func (u *UsageTracker) upsertToolEvent(event agent.ToolEvent) {
	if event.InvocationID != "" {
		if u.toolUsageByID == nil {
			u.toolUsageByID = make(map[string]int)
		}
		if idx, ok := u.toolUsageByID[event.InvocationID]; ok {
			if idx >= 0 && idx < len(u.toolUsage) && u.toolUsage[idx].InvocationID == event.InvocationID {
				u.updateToolEventAt(idx, event, toolInvocationKey{}, false)
				return
			}
			delete(u.toolUsageByID, event.InvocationID)
		}

		idx := u.appendToolEvent(event, toolInvocationKey{}, false)
		u.toolUsageByID[event.InvocationID] = idx
		return
	}

	key := toolInvocationKeyFor(event)
	u.ensureToolUsageLegacyIndex()
	if idx, ok := u.toolUsageByLegacyKey[key]; ok {
		if idx >= 0 && idx < len(u.toolUsage) && u.toolUsageLegacyKeys[idx] == key {
			if u.toolUsage[idx].InvocationID != "" {
				delete(u.toolUsageByID, u.toolUsage[idx].InvocationID)
			}
			u.updateToolEventAt(idx, event, key, true)
			return
		}
		u.repairToolUsageLegacyKey(key)
	}
	u.appendToolEvent(event, key, true)
}

func (u *UsageTracker) appendToolEvent(event agent.ToolEvent, key toolInvocationKey, indexable bool) int {
	idx := len(u.toolUsage)
	u.toolUsage = append(u.toolUsage, event)
	if !indexable {
		u.toolUsageLegacyDirty = true
		return idx
	}
	u.toolUsageLegacyKeys = append(u.toolUsageLegacyKeys, key)
	if u.toolUsageByLegacyKey == nil {
		u.toolUsageByLegacyKey = make(map[toolInvocationKey]int)
	}
	if idx, exists := u.toolUsageByLegacyKey[key]; !exists || !u.isCurrentLegacyKeyIndex(idx, key) {
		u.toolUsageByLegacyKey[key] = idx
	}
	return idx
}

func (u *UsageTracker) updateToolEventAt(idx int, event agent.ToolEvent, key toolInvocationKey, indexable bool) {
	u.toolUsage[idx] = event
	if !indexable {
		u.toolUsageLegacyDirty = true
		return
	}
	u.toolUsageLegacyKeys[idx] = key
	if u.toolUsageByLegacyKey == nil {
		u.rebuildToolUsageLegacyIndex()
		return
	}
	if existingIdx, exists := u.toolUsageByLegacyKey[key]; !exists || !u.isCurrentLegacyKeyIndex(existingIdx, key) || idx < existingIdx {
		u.toolUsageByLegacyKey[key] = idx
	}
}

func (u *UsageTracker) ensureToolUsageLegacyIndex() {
	if u.toolUsageByLegacyKey == nil || u.toolUsageLegacyDirty {
		u.rebuildToolUsageLegacyIndex()
	}
}

func (u *UsageTracker) isCurrentLegacyKeyIndex(idx int, key toolInvocationKey) bool {
	return idx >= 0 && idx < len(u.toolUsageLegacyKeys) && u.toolUsageLegacyKeys[idx] == key
}

func (u *UsageTracker) rebuildToolUsageLegacyIndex() {
	u.toolUsageLegacyKeys = make([]toolInvocationKey, len(u.toolUsage))
	u.toolUsageByLegacyKey = make(map[toolInvocationKey]int, len(u.toolUsage))
	for idx, event := range u.toolUsage {
		key := toolInvocationKeyFor(event)
		u.toolUsageLegacyKeys[idx] = key
		if _, exists := u.toolUsageByLegacyKey[key]; !exists {
			u.toolUsageByLegacyKey[key] = idx
		}
	}
	u.toolUsageLegacyDirty = false
}

func (u *UsageTracker) repairToolUsageLegacyKey(key toolInvocationKey) {
	delete(u.toolUsageByLegacyKey, key)
	for idx, existingKey := range u.toolUsageLegacyKeys {
		if existingKey == key {
			u.toolUsageByLegacyKey[key] = idx
			return
		}
	}
}

func upsertToolEvent(events []agent.ToolEvent, event agent.ToolEvent) []agent.ToolEvent {
	for i, existing := range events {
		if isSameToolInvocation(existing, event) {
			events[i] = event
			return events
		}
	}
	return append(events, event)
}

func isSameToolInvocation(left, right agent.ToolEvent) bool {
	if left.InvocationID != "" && right.InvocationID != "" {
		return left.InvocationID == right.InvocationID
	}
	return toolInvocationKeyFor(left) == toolInvocationKeyFor(right)
}

func toolAgentIDValue(value *int) int {
	if value == nil {
		return -1
	}
	return *value
}

func stableToolArguments(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func toolInvocationKeyFor(event agent.ToolEvent) toolInvocationKey {
	return toolInvocationKey{
		agentID:    toolAgentIDValue(event.AgentID),
		agentLabel: event.AgentLabel,
		toolName:   event.ToolName,
		arguments:  stableToolArguments(event.Arguments),
	}
}

func (u *UsageTracker) RecordTokenUsage(stage string, usage *agent.ChatCompletionUsage, model string) {
	if usage == nil {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.tokenUsage = append(u.tokenUsage, TokenUsageRecord{
		Stage:            stage,
		Model:            model,
		PromptTokens:     int(usage.PromptTokens),
		CompletionTokens: int(usage.CompletionTokens),
		TotalTokens:      int(usage.TotalTokens),
		CachedTokens:     int(usage.CachedTokens),
	})
}

func (u *UsageTracker) GetToolUsage() []agent.ToolEvent {
	u.mu.RLock()
	defer u.mu.RUnlock()
	res := make([]agent.ToolEvent, len(u.toolUsage))
	copy(res, u.toolUsage)
	return res
}

func (u *UsageTracker) GetTokenUsageSummary() ([]TokenUsageRecord, TokenUsageRecord) {
	u.mu.RLock()
	defer u.mu.RUnlock()

	records := make([]TokenUsageRecord, len(u.tokenUsage))
	copy(records, u.tokenUsage)

	var totals TokenUsageRecord
	totals.Stage = "total"
	for _, r := range records {
		totals.PromptTokens += r.PromptTokens
		totals.CompletionTokens += r.CompletionTokens
		totals.TotalTokens += r.TotalTokens
		totals.CachedTokens += r.CachedTokens
	}

	return records, totals
}

func (u *UsageTracker) OnToolUsage(listener func(agent.ToolEvent, []agent.ToolEvent)) func() {
	u.mu.Lock()
	defer u.mu.Unlock()
	id := u.nextID
	u.nextID++
	u.listeners[id] = listener

	// Return a function to unsubscribe
	removed := false
	return func() {
		u.mu.Lock()
		defer u.mu.Unlock()
		if removed {
			return
		}
		delete(u.listeners, id)
		removed = true
	}
}

func (u *UsageTracker) ResetToolUsage() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.toolUsage = make([]agent.ToolEvent, 0)
	u.toolUsageByID = make(map[string]int)
	u.toolUsageLegacyKeys = make([]toolInvocationKey, 0)
	u.toolUsageByLegacyKey = make(map[toolInvocationKey]int)
	u.toolUsageLegacyDirty = false
}

func (u *UsageTracker) ResetTokenUsage() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.tokenUsage = make([]TokenUsageRecord, 0)
}

func (u *UsageTracker) ResetAll() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.toolUsage = make([]agent.ToolEvent, 0)
	u.toolUsageByID = make(map[string]int)
	u.toolUsageLegacyKeys = make([]toolInvocationKey, 0)
	u.toolUsageByLegacyKey = make(map[toolInvocationKey]int)
	u.toolUsageLegacyDirty = false
	u.tokenUsage = make([]TokenUsageRecord, 0)
}
