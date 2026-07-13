package sync

import (
	"fmt"
	"testing"
	"time"

	"github.com/TaskForceAI/go-sync/pkg/sync"
)

func BenchmarkSyncPullResponseFromDomain(b *testing.B) {
	resp := makeBenchmarkPullResponse(100, 100)

	b.ReportAllocs()
	for b.Loop() {
		apiResp := syncPullResponseFromDomain(resp)
		if len(apiResp.Conversations) != 100 || len(apiResp.Messages) != 100 {
			b.Fatalf("mapped counts = %d/%d", len(apiResp.Conversations), len(apiResp.Messages))
		}
	}
}

func BenchmarkSyncPushRequestToDomain(b *testing.B) {
	req := makeBenchmarkPushRequest(100, 100)

	b.ReportAllocs()
	for b.Loop() {
		domainReq := syncPushRequestToDomain(req)
		if len(domainReq.Conversations) != 100 || len(domainReq.Messages) != 100 {
			b.Fatalf("mapped counts = %d/%d", len(domainReq.Conversations), len(domainReq.Messages))
		}
	}
}

func BenchmarkSyncPushResponseFromDomain(b *testing.B) {
	resp := &sync.SyncPushResponse{
		Success:                true,
		Conflicts:              make([]sync.ConflictRecord, 100),
		Version:                200,
		Accepted:               make([]string, 100),
		NewVersion:             200,
		ConversationIDMappings: map[string]int32{"local-1": 1},
	}
	for i := range resp.Conflicts {
		resp.Conflicts[i] = sync.ConflictRecord{
			Type:          "message",
			ID:            fmt.Sprintf("msg-%03d", i),
			Reason:        "concurrent_update",
			ServerVersion: int32(i),
			ClientVersion: int32(i + 1),
		}
		resp.Accepted[i] = fmt.Sprintf("message:msg-%03d", i)
	}

	b.ReportAllocs()
	for b.Loop() {
		apiResp := syncPushResponseFromDomain(resp)
		if len(apiResp.Conflicts) != 100 || len(apiResp.Accepted) != 100 {
			b.Fatalf("mapped counts = %d/%d", len(apiResp.Conflicts), len(apiResp.Accepted))
		}
	}
}

func makeBenchmarkPullResponse(conversationCount, messageCount int) *sync.SyncPullResponse {
	return &sync.SyncPullResponse{
		Conversations: makeBenchmarkConversations(conversationCount),
		Messages:      makeBenchmarkMessages(messageCount),
		Deletions:     []sync.DeletionRecord{{Type: "message", ID: "deleted", DeletedAt: time.Unix(1_700_000_000, 0)}},
		LatestVersion: 200,
		HasMore:       true,
		StateHash:     "100:100",
	}
}

func makeBenchmarkPushRequest(conversationCount, messageCount int) *SyncPushRequest {
	orgID := int32(7)
	return &SyncPushRequest{
		Conversations:      makeBenchmarkConversations(conversationCount),
		Messages:           makeBenchmarkMessages(messageCount),
		Deletions:          []sync.DeletionRecord{{Type: "conversation", ID: "deleted", DeletedAt: time.Unix(1_700_000_000, 0)}},
		DeviceID:           "device-1",
		ResolutionStrategy: sync.StrategyAutoMerge,
		OrganizationID:     &orgID,
	}
}

func makeBenchmarkConversations(count int) []sync.ConversationSyncPayload {
	conversations := make([]sync.ConversationSyncPayload, count)
	now := time.Unix(1_700_000_000, 0)
	result := "result"
	model := "model"
	for i := range conversations {
		conversations[i] = sync.ConversationSyncPayload{
			ID:           int32(i + 1),
			Timestamp:    now,
			UserInput:    fmt.Sprintf("prompt-%03d", i),
			Result:       &result,
			Model:        &model,
			AgentCount:   2,
			SyncVersion:  int32(i + 1),
			VectorClock:  []byte(`{"device":1}`),
			LastSyncedAt: now,
			UpdatedAt:    now,
		}
	}
	return conversations
}

func makeBenchmarkMessages(count int) []sync.MessageSyncPayload {
	messages := make([]sync.MessageSyncPayload, count)
	now := time.Unix(1_700_000_000, 0)
	for i := range messages {
		messages[i] = sync.MessageSyncPayload{
			MessageID:      fmt.Sprintf("msg-%03d", i),
			ConversationID: int32(i + 1),
			Role:           "assistant",
			Content:        "content",
			CreatedAt:      now,
			Sources:        map[string]any{"url": "https://example.com"},
			ToolEvents:     []any{map[string]any{"tool": "search"}},
			AgentStatuses:  map[string]any{"agent": "done"},
			SyncVersion:    int32(i + 1),
			VectorClock:    []byte(`{"device":1}`),
			LastSyncedAt:   now,
			UpdatedAt:      now,
		}
	}
	return messages
}
