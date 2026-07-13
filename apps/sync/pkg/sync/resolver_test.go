package sync

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestAutoMergeResolver_ResolveConversation_IdenticalInputs(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := ConversationSyncPayload{
		ID:         1,
		UserInput:  "Hello world",
		Result:     new("Result text"),
		AgentCount: 2,
	}
	client := ConversationSyncPayload{
		ID:         1,
		UserInput:  "Hello world",
		Result:     new("Result text"),
		AgentCount: 2,
	}

	merged, err := resolver.ResolveConversation(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if merged.UserInput != "Hello world" {
		t.Errorf("expected UserInput 'Hello world', got %q", merged.UserInput)
	}
	if merged.AgentCount != 2 {
		t.Errorf("expected AgentCount 2, got %d", merged.AgentCount)
	}
}

func TestAutoMergeResolver_ResolveConversation_ConcurrentUserInputEdits(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := ConversationSyncPayload{
		ID:        1,
		UserInput: "Hello world",
	}
	client := ConversationSyncPayload{
		ID:        1,
		UserInput: "Hello there",
	}

	merged, err := resolver.ResolveConversation(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The merger should attempt to merge the text changes
	// Since "Hello world" -> "Hello there" is a replacement, behavior depends on diff algorithm
	if merged.UserInput == "" {
		t.Error("merged UserInput should not be empty")
	}
	if merged.UserInput == client.UserInput {
		t.Error("merged UserInput should preserve the server edit instead of silently client-winning")
	}
	if !strings.Contains(merged.UserInput, server.UserInput) || !strings.Contains(merged.UserInput, client.UserInput) {
		t.Errorf("expected merged UserInput to contain both edits, got %q", merged.UserInput)
	}
}

func TestAutoMergeResolver_ResolveConversation_ServerAheadOnResult(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := ConversationSyncPayload{
		ID:     1,
		Result: new("Server has result"),
	}
	client := ConversationSyncPayload{
		ID:     1,
		Result: nil, // Client has no result yet
	}

	merged, err := resolver.ResolveConversation(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// LWW: server result should be preserved when client has nil
	if merged.Result == nil || *merged.Result != "Server has result" {
		t.Errorf("expected server Result to be preserved, got %v", merged.Result)
	}
}

func TestAutoMergeResolver_ResolveConversation_ClientAheadOnAgentCount(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := ConversationSyncPayload{
		ID:         1,
		AgentCount: 2,
	}
	client := ConversationSyncPayload{
		ID:         1,
		AgentCount: 5,
	}

	merged, err := resolver.ResolveConversation(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Max strategy: highest AgentCount wins
	if merged.AgentCount != 5 {
		t.Errorf("expected AgentCount 5 (max), got %d", merged.AgentCount)
	}
}

func TestAutoMergeResolver_ResolveConversation_ServerAheadOnAgentCount(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := ConversationSyncPayload{
		ID:         1,
		AgentCount: 10,
	}
	client := ConversationSyncPayload{
		ID:         1,
		AgentCount: 3,
	}

	merged, err := resolver.ResolveConversation(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Max strategy: highest AgentCount wins
	if merged.AgentCount != 10 {
		t.Errorf("expected AgentCount 10 (max), got %d", merged.AgentCount)
	}
}

func TestAutoMergeResolver_ResolveMessage_IdenticalContent(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Same content",
	}
	client := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Same content",
	}

	merged, err := resolver.ResolveMessage(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if merged.Content != "Same content" {
		t.Errorf("expected Content 'Same content', got %q", merged.Content)
	}
}

func TestAutoMergeResolver_ResolveMessage_ContentMerge(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Hello from server",
	}
	client := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Hello from client",
	}

	merged, err := resolver.ResolveMessage(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should produce some merged content
	if merged.Content == "" {
		t.Error("merged Content should not be empty")
	}
	if merged.Content == client.Content {
		t.Error("merged Content should preserve the server edit instead of silently client-winning")
	}
	if !strings.Contains(merged.Content, server.Content) || !strings.Contains(merged.Content, client.Content) {
		t.Errorf("expected merged Content to contain both edits, got %q", merged.Content)
	}
}

func TestAutoMergeResolver_mergeText(t *testing.T) {
	resolver := NewAutoMergeResolver()
	tests := []struct {
		name     string
		server   string
		incoming string
		want     string
	}{
		{name: "identical", server: "same", incoming: "same", want: "same"},
		{name: "empty server takes incoming", server: "", incoming: "client", want: "client"},
		{name: "empty incoming keeps server", server: "server", incoming: "", want: "server"},
		{name: "incoming superset wins", server: "abc", incoming: "abcdef", want: "abcdef"},
		{name: "server superset wins", server: "abcdef", incoming: "abc", want: "abcdef"},
		{name: "divergent edits concatenate", server: "left", incoming: "right", want: "left\nright"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolver.mergeText(tt.server, tt.incoming); got != tt.want {
				t.Errorf("mergeText(%q, %q) = %q, want %q", tt.server, tt.incoming, got, tt.want)
			}
		})
	}
}

func TestAutoMergeResolver_ResolveMessage_MetadataMerge(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Content",
		Sources: map[string]any{
			"source1": "value1",
		},
	}
	client := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Content",
		Sources: map[string]any{
			"source2": "value2",
		},
	}

	merged, err := resolver.ResolveMessage(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Both sources should be present in merged result
	sources, ok := merged.Sources.(map[string]any)
	if !ok {
		t.Fatal("expected Sources to be a map")
	}

	if _, hasSource1 := sources["source1"]; !hasSource1 {
		t.Error("expected source1 to be preserved in merge")
	}
	if _, hasSource2 := sources["source2"]; !hasSource2 {
		t.Error("expected source2 to be present in merge")
	}
}

func TestAutoMergeResolver_ResolveMessage_MetadataMerge_Recursive(t *testing.T) {
	resolver := NewAutoMergeResolver()

	server := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Content",
		Sources: map[string]any{
			"meta": map[string]any{
				"keep": "server",
				"edit": "server",
			},
		},
	}
	client := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "Content",
		Sources: map[string]any{
			"meta": map[string]any{
				"edit": "client",
			},
		},
	}

	merged, err := resolver.ResolveMessage(server, client)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sources, ok := merged.Sources.(map[string]any)
	if !ok {
		t.Fatal("expected Sources to be a map")
	}
	meta, ok := sources["meta"].(map[string]any)
	if !ok {
		t.Fatal("expected Sources.meta to be a map")
	}

	if meta["keep"] != "server" {
		t.Errorf("expected nested server key to be preserved, got %v", meta["keep"])
	}
	if meta["edit"] != "client" {
		t.Errorf("expected nested incoming key to override server value, got %v", meta["edit"])
	}
}

func TestAutoMergeResolver_MergeJSONFallbacks(t *testing.T) {
	resolver := NewAutoMergeResolver()

	incoming := map[string]any{"client": "wins"}
	if got := resolver.mergeJSON(map[string]any{"bad": math.Inf(1)}, incoming); !reflect.DeepEqual(got, incoming) {
		t.Fatalf("expected incoming when server cannot marshal, got %#v", got)
	}

	server := map[string]any{"server": "wins"}
	if got := resolver.mergeJSON(server, map[string]any{"bad": math.Inf(1)}); !reflect.DeepEqual(got, server) {
		t.Fatalf("expected server when incoming cannot marshal, got %#v", got)
	}

	if got := resolver.mergeJSON("server", incoming); !reflect.DeepEqual(got, incoming) {
		t.Fatalf("expected incoming when server is not a JSON object, got %#v", got)
	}
	if got := resolver.mergeJSON(server, "incoming"); !reflect.DeepEqual(got, server) {
		t.Fatalf("expected server when incoming is not a JSON object, got %#v", got)
	}
	if got := resolver.mergeJSON(nil, incoming); !reflect.DeepEqual(got, incoming) {
		t.Fatalf("expected incoming when server map is nil, got %#v", got)
	}
	if got := resolver.mergeJSON(server, nil); !reflect.DeepEqual(got, server) {
		t.Fatalf("expected server when incoming map is nil, got %#v", got)
	}
}

func TestAutoMergeResolver_MergeJSONNativeMapBranches(t *testing.T) {
	resolver := NewAutoMergeResolver()

	var nilMap map[string]any
	if got := resolver.mergeJSON(nilMap, map[string]any{"client": "value"}); !reflect.DeepEqual(got, map[string]any{"client": "value"}) {
		t.Fatalf("nil server map should return incoming, got %#v", got)
	}
	if got := resolver.mergeJSON(map[string]any{"server": "value"}, nilMap); !reflect.DeepEqual(got, map[string]any{"server": "value"}) {
		t.Fatalf("nil incoming map should return server, got %#v", got)
	}

	merged := resolver.mergeJSON(
		map[string]any{"nested": map[string]any{"server": "kept"}},
		map[string]any{"nested": map[string]any{"client": "kept"}},
	)
	expected := map[string]any{"nested": map[string]any{"server": "kept", "client": "kept"}}
	if !reflect.DeepEqual(merged, expected) {
		t.Fatalf("unexpected merge: %#v", merged)
	}
}

func TestAutoMergeResolver_MergeJSONFallbackDeepMerge(t *testing.T) {
	type metadata map[string]any
	resolver := NewAutoMergeResolver()

	merged := resolver.mergeJSON(
		metadata{"nested": map[string]any{"server": "kept"}},
		metadata{"nested": map[string]any{"client": "kept"}},
	)
	expected := map[string]any{"nested": map[string]any{"server": "kept", "client": "kept"}}
	if !reflect.DeepEqual(merged, expected) {
		t.Fatalf("unexpected fallback merge: %#v", merged)
	}
}

func TestNativeJSONMapRejectsInvalidArrayItem(t *testing.T) {
	value := map[string]any{"items": []any{func() {}}}

	native, ok := nativeJSONMap(value)

	if ok || native != nil {
		t.Fatalf("nativeJSONMap should reject function values, got %#v ok=%t", native, ok)
	}
}

func TestIsNativeJSONMapNil(t *testing.T) {
	if !isNativeJSONMap(nil, map[uintptr]struct{}{}) {
		t.Fatal("nil native JSON map should be valid")
	}
}

func TestNativeJSONMapDetectsFastPathSafeMetadata(t *testing.T) {
	valid := map[string]any{
		"title":   "source",
		"enabled": true,
		"score":   float64(12.5),
		"missing": nil,
		"nested": map[string]any{
			"tags": []any{"alpha", float64(2), false, nil},
		},
	}
	got, ok := nativeJSONMap(valid)
	if !ok {
		t.Fatal("expected native JSON metadata map to use fast path")
	}
	if !reflect.DeepEqual(got, valid) {
		t.Fatalf("native JSON map changed value: %#v", got)
	}

	for name, value := range map[string]any{
		"integer": map[string]any{"count": 1},
		"nan":     map[string]any{"score": math.NaN()},
	} {
		if got, ok := nativeJSONMap(value); ok {
			t.Fatalf("%s value unexpectedly used fast path: %#v", name, got)
		}
	}

	cyclic := map[string]any{}
	cyclic["self"] = cyclic
	if got, ok := nativeJSONMap(cyclic); ok {
		t.Fatalf("cyclic metadata unexpectedly used fast path: %#v", got)
	}
}

func TestAutoMergeResolver_MergeText_EmptyStrings(t *testing.T) {
	resolver := NewAutoMergeResolver()

	// Both empty
	result := resolver.mergeText("", "")
	if result != "" {
		t.Errorf("expected empty string, got %q", result)
	}

	// Server empty, client has content
	result = resolver.mergeText("", "client content")
	if result == "" {
		t.Error("expected non-empty result when client has content")
	}
}

func TestAutoMergeResolver_MergeJSON_NilInputs(t *testing.T) {
	resolver := NewAutoMergeResolver()

	// Both nil
	result := resolver.mergeJSON(nil, nil)
	if result != nil {
		t.Errorf("expected nil when both inputs are nil, got %v", result)
	}

	// Server has value, client nil
	serverMap := map[string]any{"key": "value"}
	result = resolver.mergeJSON(serverMap, nil)
	if result == nil {
		t.Error("expected server value when client is nil")
	}

	// Server nil, client has value
	clientMap := map[string]any{"key": "value"}
	result = resolver.mergeJSON(nil, clientMap)
	if result == nil {
		t.Error("expected client value when server is nil")
	}
}

func TestResolutionStrategy_Constants(t *testing.T) {
	// Verify strategy constants are defined correctly
	if StrategyServerWins != "server_wins" {
		t.Errorf("expected StrategyServerWins to be 'server_wins', got %q", StrategyServerWins)
	}
	if StrategyClientWins != "client_wins" {
		t.Errorf("expected StrategyClientWins to be 'client_wins', got %q", StrategyClientWins)
	}
	if StrategyAutoMerge != "auto_merge" {
		t.Errorf("expected StrategyAutoMerge to be 'auto_merge', got %q", StrategyAutoMerge)
	}
}

func BenchmarkAutoMergeResolver_MergeJSONMetadataMaps(b *testing.B) {
	resolver := NewAutoMergeResolver()
	server := makeNestedMetadata("server", 75)
	incoming := makeNestedMetadata("incoming", 75)

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		merged := resolver.mergeJSON(server, incoming)
		result, ok := merged.(map[string]any)
		if !ok {
			b.Fatalf("merged metadata type = %T, want map[string]any", merged)
		}
		if result["server-only-1"] == nil || result["incoming-only-1"] == nil {
			b.Fatalf("merged metadata lost server or incoming keys")
		}
	}
}

func makeNestedMetadata(prefix string, count int) map[string]any {
	out := make(map[string]any, count*3)
	for i := range count {
		out[fmt.Sprintf("shared-%d", i)] = map[string]any{
			"owner": prefix,
			"nested": map[string]any{
				"rank": float64(i),
				"tags": []any{prefix, fmt.Sprintf("tag-%d", i)},
			},
		}
		out[fmt.Sprintf("%s-only-%d", prefix, i)] = map[string]any{
			"enabled": i%2 == 0,
			"score":   float64(i) / 10,
		}
	}
	return out
}

// Helper function
//
