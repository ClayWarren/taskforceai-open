package sync

import (
	"encoding/json"
	"log/slog"
	"maps"
	"math"
	"reflect"
	"strings"

	"github.com/sergi/go-diff/diffmatchpatch"
)

// ConflictResolver defines the interface for resolving concurrent update conflicts.
type ConflictResolver interface {
	ResolveConversation(server, incoming ConversationSyncPayload) (ConversationSyncPayload, error)
	ResolveMessage(server, incoming MessageSyncPayload) (MessageSyncPayload, error)
}

// AutoMergeResolver implements ConflictResolver using 3-way merge strategies.
type AutoMergeResolver struct {
	dmp *diffmatchpatch.DiffMatchPatch
}

func NewAutoMergeResolver() *AutoMergeResolver {
	return &AutoMergeResolver{
		dmp: diffmatchpatch.New(),
	}
}

func (r *AutoMergeResolver) ResolveConversation(server, incoming ConversationSyncPayload) (ConversationSyncPayload, error) {
	slog.Info("Auto-resolving conversation conflict", "id", server.ID)

	// 1. Text Merge for UserInput
	mergedInput := r.mergeText(server.UserInput, incoming.UserInput)
	incoming.UserInput = mergedInput

	// 2. LWW for Result (Simple field)
	if incoming.Result == nil && server.Result != nil {
		incoming.Result = server.Result
	}

	// 3. Max for AgentCount
	if server.AgentCount > incoming.AgentCount {
		incoming.AgentCount = server.AgentCount
	}

	return incoming, nil
}

func (r *AutoMergeResolver) ResolveMessage(server, incoming MessageSyncPayload) (MessageSyncPayload, error) {
	slog.Info("Auto-resolving message conflict", "id", server.MessageID)

	// 1. Text Merge for Content
	mergedContent := r.mergeText(server.Content, incoming.Content)
	incoming.Content = mergedContent

	// 2. Recursive JSON Merge for Metadata fields
	incoming.Sources = r.mergeJSON(server.Sources, incoming.Sources)
	incoming.ToolEvents = r.mergeJSON(server.ToolEvents, incoming.ToolEvents)
	incoming.AgentStatuses = r.mergeJSON(server.AgentStatuses, incoming.AgentStatuses)

	return incoming, nil
}

// mergeText preserves both divergent edits when no common ancestor is available.
func (r *AutoMergeResolver) mergeText(server, incoming string) string {
	if server == incoming {
		return server
	}
	if server == "" {
		return incoming
	}
	if incoming == "" {
		return server
	}
	if strings.Contains(incoming, server) {
		return incoming
	}
	if strings.Contains(server, incoming) {
		return server
	}
	return server + "\n" + incoming
}

// mergeJSON merges two JSON structures by preferring incoming for specific keys but preserving server keys.
func (r *AutoMergeResolver) mergeJSON(server, incoming any) any {
	sMap, serverFastPath := nativeJSONMap(server)
	iMap, incomingFastPath := nativeJSONMap(incoming)
	if serverFastPath && incomingFastPath {
		if sMap == nil {
			return incoming
		}
		if iMap == nil {
			return server
		}
		return deepMergeJSONMaps(sMap, iMap)
	}

	sMap, err := normalizeJSONMap(server)
	if err != nil {
		slog.Warn("mergeJSON: failed to marshal server value", "error", err)
		return incoming
	}
	iMap, err = normalizeJSONMap(incoming)
	if err != nil {
		slog.Warn("mergeJSON: failed to marshal incoming value", "error", err)
		return server
	}

	if sMap == nil {
		return incoming
	}
	if iMap == nil {
		return server
	}

	return deepMergeJSONMaps(sMap, iMap)
}

func normalizeJSONMap(value any) (map[string]any, error) {
	if native, ok := nativeJSONMap(value); ok {
		return native, nil
	}

	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func nativeJSONMap(value any) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	if m == nil {
		return nil, true
	}
	if !isNativeJSONValue(m, map[uintptr]struct{}{}) {
		return nil, false
	}
	return m, true
}

func isNativeJSONValue(value any, seen map[uintptr]struct{}) bool {
	switch typed := value.(type) {
	case nil, string, bool:
		return true
	case float64:
		return !math.IsInf(typed, 0) && !math.IsNaN(typed)
	case map[string]any:
		return isNativeJSONMap(typed, seen)
	case []any:
		for _, item := range typed {
			if !isNativeJSONValue(item, seen) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func isNativeJSONMap(value map[string]any, seen map[uintptr]struct{}) bool {
	if value == nil {
		return true
	}
	key := reflect.ValueOf(value).Pointer()
	if key != 0 {
		if _, exists := seen[key]; exists {
			return false
		}
		seen[key] = struct{}{}
		defer delete(seen, key)
	}
	for _, item := range value {
		if !isNativeJSONValue(item, seen) {
			return false
		}
	}
	return true
}

func deepMergeJSONMaps(server, incoming map[string]any) map[string]any {
	merged := make(map[string]any, len(incoming))
	maps.Copy(merged, incoming)

	for key, serverValue := range server {
		incomingValue, exists := merged[key]
		if !exists {
			merged[key] = serverValue
			continue
		}

		serverMap, serverIsMap := serverValue.(map[string]any)
		incomingMap, incomingIsMap := incomingValue.(map[string]any)
		if serverIsMap && incomingIsMap {
			merged[key] = deepMergeJSONMaps(serverMap, incomingMap)
		}
	}

	return merged
}
