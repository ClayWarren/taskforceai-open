package sync

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func BenchmarkSyncServiceLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	b.Run("PullChanges", func(b *testing.B) {
		repo := newLatencySyncRepository(24, 24)
		svc := NewService(repo, nil, nil, nil, nil, nil)
		var auditWG sync.WaitGroup
		svc.runAsync = func(fn func()) {
			auditWG.Add(1)
			go func() {
				defer auditWG.Done()
				fn()
			}()
		}
		samples := make([]time.Duration, 0, b.N)
		req := SyncPullRequest{LastSyncVersion: 0, Limit: 48}

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			resp, err := svc.PullChanges(context.Background(), "user-1", "device-1", "benchmark-agent", req)
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("PullChanges failed: %v", err)
			}
			if len(resp.Conversations)+len(resp.Messages) != 48 {
				b.Fatalf("unexpected pull item count: %d", len(resp.Conversations)+len(resp.Messages))
			}
		}
		b.StopTimer()
		auditWG.Wait()
		reportSyncLatencyProfile(b, samples)
	})

	b.Run("PushChanges", func(b *testing.B) {
		repo := newLatencySyncRepository(0, 0)
		svc := NewService(repo, nil, nil, nil, nil, nil)
		samples := make([]time.Duration, 0, b.N)
		localConversationID := "local-conversation"
		req := SyncPushRequest{
			Conversations: []ConversationSyncPayload{
				{
					LocalID:     &localConversationID,
					UserInput:   "new synced prompt",
					AgentCount:  1,
					VectorClock: VectorClock{"device-1": 1}.Encode(),
					Timestamp:   time.Unix(1_700_000_100, 0).UTC(),
					UpdatedAt:   time.Unix(1_700_000_100, 0).UTC(),
				},
			},
			Messages: []MessageSyncPayload{
				{
					MessageID:      "latency-message",
					ConversationID: 1,
					Role:           "user",
					Content:        "hello from sync benchmark",
					Sources:        map[string]any{"source": "benchmark"},
					ToolEvents:     []any{},
					AgentStatuses:  []any{},
					Trace:          map[string]any{"trace": true},
					VectorClock:    VectorClock{"device-1": 1}.Encode(),
					CreatedAt:      time.Unix(1_700_000_100, 0).UTC(),
					UpdatedAt:      time.Unix(1_700_000_100, 0).UTC(),
				},
			},
		}

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			resp, err := svc.PushChanges(context.Background(), "user-1", "device-1", "benchmark-agent", "", req)
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("PushChanges failed: %v", err)
			}
			if !resp.Success {
				b.Fatal("expected successful push response")
			}
		}
		b.StopTimer()
		reportSyncLatencyProfile(b, samples)
	})
}

func BenchmarkPostgresSyncPullLatencyProfile(b *testing.B) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if os.Getenv("TASKFORCE_LATENCY_DEPS") != "1" {
		b.Skip("set TASKFORCE_LATENCY_DEPS=1 to run dependency-backed latency benchmarks")
	}
	if databaseURL == "" {
		b.Skip("DATABASE_URL is required for dependency-backed sync benchmarks")
	}

	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		b.Fatalf("connect postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		b.Fatalf("ping postgres: %v", err)
	}

	userID := "latency-sync-deps-user"
	deviceID := "latency-sync-deps-device"
	conversationIDs, err := seedPostgresSyncPullRows(ctx, pool, userID, deviceID, 24, 24)
	if err != nil {
		pool.Close()
		b.Fatalf("seed postgres sync rows: %v", err)
	}
	b.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, "DELETE FROM sync_audit_logs WHERE user_id = $1", userID)
		_, _ = pool.Exec(cleanupCtx, "DELETE FROM sync_devices WHERE user_id = $1", userID)
		_, _ = pool.Exec(cleanupCtx, "DELETE FROM conversations WHERE user_id = $1", userID)
		pool.Close()
	})

	timedRepo := newLatencyTimedRepository(NewRepository(db.New(pool)))
	svc := NewService(timedRepo, nil, nil, nil, nil, nil)
	var auditWG sync.WaitGroup
	svc.runAsync = func(fn func()) {
		auditWG.Add(1)
		go func() {
			defer auditWG.Done()
			fn()
		}()
	}
	req := SyncPullRequest{LastSyncVersion: 0, Limit: 48}
	samples := make([]time.Duration, 0, b.N)
	nonDBSamples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		timedRepo.beginIteration()
		startedAt := time.Now()
		resp, err := svc.PullChanges(context.Background(), userID, deviceID, "benchmark-agent", req)
		elapsed := time.Since(startedAt)
		dbElapsed := timedRepo.endIteration()
		samples = append(samples, elapsed)
		if elapsed > dbElapsed {
			nonDBSamples = append(nonDBSamples, elapsed-dbElapsed)
		} else {
			nonDBSamples = append(nonDBSamples, 0)
		}
		if err != nil {
			b.Fatalf("PullChanges failed: %v", err)
		}
		if len(resp.Conversations)+len(resp.Messages) != len(conversationIDs)+24 {
			b.Fatalf("unexpected pull item count: %d", len(resp.Conversations)+len(resp.Messages))
		}
	}
	b.StopTimer()
	auditWG.Wait()
	reportSyncLatencyProfile(b, samples)
	reportNamedSyncLatencyProfile(b, "non_db", nonDBSamples)
	timedRepo.report(b)
}

func seedPostgresSyncPullRows(ctx context.Context, pool *pgxpool.Pool, userID string, deviceID string, conversationCount int, messageCount int) ([]int32, error) {
	_, _ = pool.Exec(ctx, "DELETE FROM sync_audit_logs WHERE user_id = $1", userID)
	_, _ = pool.Exec(ctx, "DELETE FROM sync_devices WHERE user_id = $1", userID)
	_, _ = pool.Exec(ctx, "DELETE FROM conversations WHERE user_id = $1", userID)

	ids := make([]int32, 0, conversationCount)
	for i := 0; i < conversationCount; i++ {
		var id int32
		err := pool.QueryRow(ctx, `
INSERT INTO conversations (
  user_id, user_input, result, execution_time, model, agent_count,
  vector_clock, sync_version, device_id, updated_at
) VALUES (
  $1, $2, $3, 1.25, 'openai/gpt-5.6-sol', 2,
  $4::jsonb, $5, $6, NOW()
) RETURNING id
`, userID, fmt.Sprintf("dependency prompt %d", i), fmt.Sprintf("dependency result %d", i), fmt.Sprintf(`{"%s":%d}`, deviceID, i+1), i+1, deviceID).Scan(&id)
		if err != nil {
			return nil, fmt.Errorf("insert conversation %d: %w", i, err)
		}
		ids = append(ids, id)
	}

	for i := 0; i < messageCount; i++ {
		conversationID := ids[i%len(ids)]
		version := conversationCount + i + 1
		_, err := pool.Exec(ctx, `
INSERT INTO messages (
  message_id, conversation_id, role, content, sources, tool_events,
  agent_statuses, trace, vector_clock, sync_version, device_id, updated_at
) VALUES (
  $1, $2, 'assistant', $3, '{"source":"benchmark"}'::jsonb, '[]'::jsonb,
  '[{"status":"DONE"}]'::jsonb, '{"trace":true}'::jsonb, $4::jsonb, $5, $6, NOW()
)
`, fmt.Sprintf("latency-sync-deps-message-%d", i), conversationID, fmt.Sprintf("dependency message content %d", i), fmt.Sprintf(`{"%s":%d}`, deviceID, version), version, deviceID)
		if err != nil {
			return nil, fmt.Errorf("insert message %d: %w", i, err)
		}
	}
	return ids, nil
}

type latencySyncRepository struct {
	conversations []ConversationRecord
	messages      []MessageRecord
}

func newLatencySyncRepository(conversationCount, messageCount int) *latencySyncRepository {
	now := time.Unix(1_700_000_000, 0).UTC()
	userID := "user-1"
	deviceID := "device-1"
	result := "benchmark result"
	model := "openai/gpt-5.6-sol"

	repo := &latencySyncRepository{
		conversations: make([]ConversationRecord, conversationCount),
		messages:      make([]MessageRecord, messageCount),
	}
	for i := range repo.conversations {
		version := int32(i + 1)
		repo.conversations[i] = ConversationRecord{
			ID:            version,
			UserID:        &userID,
			UserInput:     fmt.Sprintf("prompt-%d", i),
			Result:        &result,
			Model:         &model,
			AgentCount:    2,
			SyncVersion:   version,
			VectorClock:   VectorClock{deviceID: version}.Encode(),
			DeviceID:      &deviceID,
			Timestamp:     Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
			LastSyncedAt:  Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
			UpdatedAt:     Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
			ExecutionTime: ptrFloat64(1.25),
		}
	}
	for i := range repo.messages {
		version := int32(conversationCount + i + 1)
		repo.messages[i] = MessageRecord{
			ID:             version,
			MessageID:      fmt.Sprintf("msg-%d", i),
			ConversationID: 1,
			Role:           "assistant",
			Content:        fmt.Sprintf("message content %d", i),
			Sources:        []byte(`{"source":"benchmark"}`),
			ToolEvents:     []byte(`[]`),
			AgentStatuses:  []byte(`[{"status":"DONE"}]`),
			Trace:          []byte(`{"trace":true}`),
			SyncVersion:    version,
			VectorClock:    VectorClock{deviceID: version}.Encode(),
			DeviceID:       &deviceID,
			CreatedAt:      Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
			LastSyncedAt:   Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
			UpdatedAt:      Timestamp{Time: now.Add(time.Duration(i) * time.Second), Valid: true},
		}
	}
	return repo
}

func (r *latencySyncRepository) GetLatestSyncVersion(context.Context, string) (int32, error) {
	return int32(len(r.conversations) + len(r.messages)), nil
}

func (r *latencySyncRepository) GetLatestOrgSyncVersion(context.Context, int32) (int32, error) {
	return r.GetLatestSyncVersion(context.Background(), "")
}

func (r *latencySyncRepository) GetConversationsAfterVersion(context.Context, string, int32, int32) ([]ConversationRecord, error) {
	return r.conversations, nil
}

func (r *latencySyncRepository) GetConversationsByOrgAfterVersion(context.Context, int32, int32, int32) ([]ConversationRecord, error) {
	return r.conversations, nil
}

func (r *latencySyncRepository) GetMessagesAfterVersion(context.Context, string, int32, int32) ([]MessageRecord, error) {
	return r.messages, nil
}

func (r *latencySyncRepository) GetMessagesByOrgAfterVersion(context.Context, int32, int32, int32) ([]MessageRecord, error) {
	return r.messages, nil
}

func (r *latencySyncRepository) GetConversationVersion(context.Context, int32, *string) (ConversationVersion, error) {
	return ConversationVersion{}, nil
}

func (r *latencySyncRepository) GetConversationVersionWithOrg(context.Context, int32, *string, int32) (ConversationVersion, error) {
	return ConversationVersion{}, nil
}

func (r *latencySyncRepository) GetConversation(context.Context, int32) (ConversationRecord, error) {
	return ConversationRecord{}, nil
}

func (r *latencySyncRepository) GetConversationWithOrg(context.Context, int32, int32) (ConversationRecord, error) {
	return ConversationRecord{}, nil
}

func (r *latencySyncRepository) UpdateConversationSync(context.Context, UpdateConversationInput) error {
	return nil
}

func (r *latencySyncRepository) CreateConversationSync(context.Context, CreateConversationInput) (ConversationRecord, error) {
	return ConversationRecord{ID: 1}, nil
}

func (r *latencySyncRepository) GetMessageVersion(context.Context, string) (MessageVersion, error) {
	return MessageVersion{}, nil
}

func (r *latencySyncRepository) GetMessageVersionScoped(context.Context, string, string, *int32) (MessageVersion, error) {
	return MessageVersion{}, ErrNotFound
}

func (r *latencySyncRepository) GetMessageByMessageID(context.Context, string) (MessageRecord, error) {
	return MessageRecord{}, nil
}

func (r *latencySyncRepository) GetMessageByMessageIDScoped(context.Context, string, string, *int32) (MessageRecord, error) {
	return MessageRecord{}, nil
}

func (r *latencySyncRepository) UpdateMessageSync(context.Context, UpdateMessageInput) error {
	return nil
}

func (r *latencySyncRepository) CreateMessageSync(context.Context, CreateMessageInput) (MessageRecord, error) {
	return MessageRecord{MessageID: "latency-message"}, nil
}

func (r *latencySyncRepository) AdvanceSyncVersionSequence(context.Context, int32) error {
	return nil
}

func (r *latencySyncRepository) NextSyncVersion(_ context.Context, after int32) (int32, error) {
	return after + 1, nil
}

func (r *latencySyncRepository) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return fn(r)
}

func (r *latencySyncRepository) CreateSyncAuditLog(context.Context, SyncAuditInput) (SyncAuditRecord, error) {
	return SyncAuditRecord{}, nil
}

func (r *latencySyncRepository) GetConversationsCount(context.Context, string) (int64, error) {
	return int64(len(r.conversations)), nil
}

func (r *latencySyncRepository) GetMessagesCount(context.Context, string) (int64, error) {
	return int64(len(r.messages)), nil
}

func (r *latencySyncRepository) CountConversationsByOrg(context.Context, int32) (int64, error) {
	return int64(len(r.conversations)), nil
}

func (r *latencySyncRepository) CountMessagesByOrg(context.Context, int32) (int64, error) {
	return int64(len(r.messages)), nil
}

func (r *latencySyncRepository) GetSyncCounts(context.Context, string, *int32) (int64, int64, error) {
	return int64(len(r.conversations)), int64(len(r.messages)), nil
}

func (r *latencySyncRepository) IsSyncDeviceRevoked(context.Context, string, string) (bool, error) {
	return false, nil
}

func (r *latencySyncRepository) UpsertSyncDevice(context.Context, UpsertSyncDeviceInput) (SyncDeviceRecord, error) {
	return SyncDeviceRecord{DeviceID: "device-1"}, nil
}

func (r *latencySyncRepository) GetSyncDevices(context.Context, string) ([]SyncDeviceRecord, error) {
	return []SyncDeviceRecord{{DeviceID: "device-1"}}, nil
}

func (r *latencySyncRepository) RevokeSyncDevice(context.Context, string, string) error {
	return nil
}

type latencyTimedRepository struct {
	SyncRepository
	mu               sync.Mutex
	samples          map[string][]time.Duration
	currentIteration time.Duration
	measuring        bool
}

func newLatencyTimedRepository(inner SyncRepository) *latencyTimedRepository {
	return &latencyTimedRepository{
		SyncRepository: inner,
		samples:        make(map[string][]time.Duration),
	}
}

func (r *latencyTimedRepository) beginIteration() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.currentIteration = 0
	r.measuring = true
}

func (r *latencyTimedRepository) endIteration() time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.measuring = false
	return r.currentIteration
}

func (r *latencyTimedRepository) report(b *testing.B) {
	b.Helper()
	for _, name := range []string{
		"device_revocation_check",
		"device_heartbeat_async",
		"conversations_query",
		"messages_query",
		"state_hash_counts",
		"audit_insert_async",
	} {
		reportNamedSyncLatencyProfile(b, name, r.samplesFor(name))
	}
}

func (r *latencyTimedRepository) samplesFor(name string) []time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]time.Duration(nil), r.samples[name]...)
}

func timedSyncRepoCall[T any](r *latencyTimedRepository, name string, fn func() (T, error)) (T, error) {
	return timedSyncRepoCallWithPath(r, name, true, fn)
}

func timedBackgroundSyncRepoCall[T any](r *latencyTimedRepository, name string, fn func() (T, error)) (T, error) {
	return timedSyncRepoCallWithPath(r, name, false, fn)
}

func timedSyncRepoCallWithPath[T any](r *latencyTimedRepository, name string, responsePath bool, fn func() (T, error)) (T, error) {
	startedAt := time.Now()
	value, err := fn()
	elapsed := time.Since(startedAt)
	r.mu.Lock()
	if responsePath && r.measuring {
		r.currentIteration += elapsed
	}
	r.samples[name] = append(r.samples[name], elapsed)
	r.mu.Unlock()
	return value, err
}

func (r *latencyTimedRepository) GetConversationsAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	return timedSyncRepoCall(r, "conversations_query", func() ([]ConversationRecord, error) {
		return r.SyncRepository.GetConversationsAfterVersion(ctx, userID, lastVersion, limit)
	})
}

func (r *latencyTimedRepository) GetConversationsByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	return timedSyncRepoCall(r, "conversations_query", func() ([]ConversationRecord, error) {
		return r.SyncRepository.GetConversationsByOrgAfterVersion(ctx, orgID, lastVersion, limit)
	})
}

func (r *latencyTimedRepository) GetMessagesAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]MessageRecord, error) {
	return timedSyncRepoCall(r, "messages_query", func() ([]MessageRecord, error) {
		return r.SyncRepository.GetMessagesAfterVersion(ctx, userID, lastVersion, limit)
	})
}

func (r *latencyTimedRepository) GetMessagesByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]MessageRecord, error) {
	return timedSyncRepoCall(r, "messages_query", func() ([]MessageRecord, error) {
		return r.SyncRepository.GetMessagesByOrgAfterVersion(ctx, orgID, lastVersion, limit)
	})
}

func (r *latencyTimedRepository) CreateSyncAuditLog(ctx context.Context, params SyncAuditInput) (SyncAuditRecord, error) {
	return timedBackgroundSyncRepoCall(r, "audit_insert_async", func() (SyncAuditRecord, error) {
		return r.SyncRepository.CreateSyncAuditLog(ctx, params)
	})
}

func (r *latencyTimedRepository) GetConversationsCount(ctx context.Context, userID string) (int64, error) {
	return timedSyncRepoCall(r, "state_hash_conversation_count", func() (int64, error) {
		return r.SyncRepository.GetConversationsCount(ctx, userID)
	})
}

func (r *latencyTimedRepository) GetMessagesCount(ctx context.Context, userID string) (int64, error) {
	return timedSyncRepoCall(r, "state_hash_message_count", func() (int64, error) {
		return r.SyncRepository.GetMessagesCount(ctx, userID)
	})
}

func (r *latencyTimedRepository) CountConversationsByOrg(ctx context.Context, orgID int32) (int64, error) {
	return timedSyncRepoCall(r, "state_hash_conversation_count", func() (int64, error) {
		return r.SyncRepository.CountConversationsByOrg(ctx, orgID)
	})
}

func (r *latencyTimedRepository) CountMessagesByOrg(ctx context.Context, orgID int32) (int64, error) {
	return timedSyncRepoCall(r, "state_hash_message_count", func() (int64, error) {
		return r.SyncRepository.CountMessagesByOrg(ctx, orgID)
	})
}

func (r *latencyTimedRepository) GetSyncCounts(ctx context.Context, userID string, orgID *int32) (int64, int64, error) {
	startedAt := time.Now()
	convCount, msgCount, err := r.SyncRepository.GetSyncCounts(ctx, userID, orgID)
	elapsed := time.Since(startedAt)
	r.mu.Lock()
	if r.measuring {
		r.currentIteration += elapsed
	}
	r.samples["state_hash_counts"] = append(r.samples["state_hash_counts"], elapsed)
	r.mu.Unlock()
	return convCount, msgCount, err
}

func (r *latencyTimedRepository) IsSyncDeviceRevoked(ctx context.Context, userID string, deviceID string) (bool, error) {
	return timedSyncRepoCall(r, "device_revocation_check", func() (bool, error) {
		return r.SyncRepository.IsSyncDeviceRevoked(ctx, userID, deviceID)
	})
}

func (r *latencyTimedRepository) UpsertSyncDevice(ctx context.Context, params UpsertSyncDeviceInput) (SyncDeviceRecord, error) {
	return timedBackgroundSyncRepoCall(r, "device_heartbeat_async", func() (SyncDeviceRecord, error) {
		return r.SyncRepository.UpsertSyncDevice(ctx, params)
	})
}

func reportSyncLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	reportNamedSyncLatencyProfile(b, "", samples)
}

func reportNamedSyncLatencyProfile(b *testing.B, prefix string, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(benchtest.PercentileDuration(ordered, 0.50).Microseconds()), syncMetricName(prefix, "p50_us"))
	b.ReportMetric(float64(benchtest.PercentileDuration(ordered, 0.95).Microseconds()), syncMetricName(prefix, "p95_us"))
	b.ReportMetric(float64(benchtest.PercentileDuration(ordered, 0.99).Microseconds()), syncMetricName(prefix, "p99_us"))
}

func syncMetricName(prefix string, suffix string) string {
	if prefix == "" {
		return suffix
	}
	return prefix + "_" + suffix
}
