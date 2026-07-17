package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/server"
)

var (
	errSyncPullChangeExceedsBudget = errors.New("sync pull change exceeds payload budget")
	pullResponseBudgetBytes        = server.VercelFunctionSafeJSONPayloadBytes
)

func boundedInt32Count(count int) int32 {
	if count > math.MaxInt32 {
		return math.MaxInt32
	}
	if count < math.MinInt32 {
		return math.MinInt32
	}
	return int32(count) // #nosec G115 -- count is bounded to int32 range above.
}

func (s *Service) PullChanges(ctx context.Context, userID string, deviceID string, userAgent string, req SyncPullRequest) (_ *SyncPullResponse, retErr error) {
	start := time.Now()
	ctx, finishOperation := s.startOperation(ctx, "sync.PullChanges", &retErr)
	defer finishOperation()

	if err := s.heartbeatPullDevice(ctx, userID, deviceID, userAgent); err != nil {
		return nil, err
	}

	limit := req.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	conversations, messages, err := s.fetchChanges(ctx, userID, req)
	if err != nil {
		slog.Error("Sync pull fetch changes failed", "userId", userID, "error", err)
		return nil, err
	}

	trimmedConvs, trimmedMsgs, hasMore := trimChangesByGlobalLimit(conversations, messages, limit)

	hashCtx, cancelHash := context.WithTimeout(ctx, syncAdvisoryDBTimeout)
	stateHash, err := s.calculateStateHash(hashCtx, userID, req.OrganizationID)
	cancelHash()
	if err != nil {
		// Hash is advisory; keep pull successful even if count queries fail.
		slog.Warn("Sync pull state hash calculation failed", "userId", userID, "orgId", req.OrganizationID, "error", err)
		stateHash = ""
	}

	response, budgetTrimmed, err := trimPullResponseToJSONBudget(
		req.LastSyncVersion,
		trimmedConvs,
		trimmedMsgs,
		hasMore,
		stateHash,
		pullResponseBudgetBytes,
	)
	if err != nil {
		return nil, err
	}
	if budgetTrimmed {
		slog.Warn(
			"Sync pull response trimmed to Vercel payload budget",
			"userId",
			userID,
			"orgId",
			req.OrganizationID,
			"budgetBytes",
			pullResponseBudgetBytes,
			"count",
			len(response.Conversations)+len(response.Messages),
		)
	}

	totalItemsCount := boundedInt32Count(len(response.Conversations) + len(response.Messages))
	duration := time.Since(start)

	if s.telemetry != nil {
		s.telemetry.RecordSync(ctx, "PULL", duration, totalItemsCount, 0)
	}

	s.recordPullSyncAudit(ctx, userID, deviceID, req.LastSyncVersion, response.LatestVersion, totalItemsCount, duration)

	slog.Info("Sync pull completed", "userId", userID, "orgId", req.OrganizationID, "count", totalItemsCount)

	return &response, nil
}

func jsonColumnValue(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}
	if !json.Valid(raw) {
		return nil
	}
	copied := make(json.RawMessage, len(raw))
	copy(copied, raw)
	return copied
}

func mapConversationToPayload(conv ConversationRecord) ConversationSyncPayload {
	return conversationPayloadFromRecord(&conv)
}

func mapMessageToPayload(msg MessageRecord) MessageSyncPayload {
	return MessageSyncPayload{
		MessageID:      msg.MessageID,
		ConversationID: msg.ConversationID,
		Role:           msg.Role,
		Content:        msg.Content,
		IsStreaming:    msg.IsStreaming,
		IsAgentStatus:  msg.IsAgentStatus,
		ElapsedSeconds: msg.ElapsedSeconds,
		CreatedAt:      msg.CreatedAt.Time,
		Error:          msg.Error,
		Sources:        jsonColumnValue(msg.Sources),
		ToolEvents:     jsonColumnValue(msg.ToolEvents),
		AgentStatuses:  jsonColumnValue(msg.AgentStatuses),
		SyncVersion:    msg.SyncVersion,
		VectorClock:    msg.VectorClock,
		LastSyncedAt:   msg.LastSyncedAt.Time,
		DeviceID:       msg.DeviceID,
		IsDeleted:      msg.IsDeleted,
		UpdatedAt:      msg.UpdatedAt.Time,
	}
}

func syncDeletionRecords(conversations []ConversationRecord, messages []MessageRecord) []DeletionRecord {
	deletions := []DeletionRecord{}
	for _, conversation := range conversations {
		if conversation.IsDeleted {
			deletions = append(deletions, DeletionRecord{
				Type:      "conversation",
				ID:        fmt.Sprintf("%d", conversation.ID),
				DeletedAt: conversation.UpdatedAt.Time,
			})
		}
	}
	for _, message := range messages {
		if message.IsDeleted {
			deletions = append(deletions, DeletionRecord{
				Type:      "message",
				ID:        message.MessageID,
				DeletedAt: message.UpdatedAt.Time,
			})
		}
	}
	return deletions
}

func latestSyncVersion(current int32, conversations []ConversationRecord, messages []MessageRecord) int32 {
	latest := current
	for _, conversation := range conversations {
		if conversation.SyncVersion > latest {
			latest = conversation.SyncVersion
		}
	}
	for _, message := range messages {
		if message.SyncVersion > latest {
			latest = message.SyncVersion
		}
	}
	return latest
}

func trimChangesByGlobalLimit(
	conversations []ConversationRecord,
	messages []MessageRecord,
	limit int32,
) ([]ConversationRecord, []MessageRecord, bool) {
	if limit <= 0 {
		return []ConversationRecord{}, []MessageRecord{}, len(conversations)+len(messages) > 0
	}

	total := len(conversations) + len(messages)
	if total <= int(limit) {
		return conversations, messages, false
	}

	refs := sortedChangeRefs(conversations, messages)
	selectedConversations, selectedMessages := trimChangesBySortedRefs(conversations, messages, refs, int(limit))
	return selectedConversations, selectedMessages, true
}

func sortedChangeRefs(conversations []ConversationRecord, messages []MessageRecord) []changeRef {
	total := len(conversations) + len(messages)
	refs := make([]changeRef, 0, total)
	for i, conversation := range conversations {
		refs = append(refs, changeRef{
			kind:      0,
			index:     i,
			version:   conversation.SyncVersion,
			updatedAt: conversation.UpdatedAt.Time,
		})
	}
	for i, message := range messages {
		refs = append(refs, changeRef{
			kind:      1,
			index:     i,
			version:   message.SyncVersion,
			updatedAt: message.UpdatedAt.Time,
		})
	}

	sort.SliceStable(refs, func(i, j int) bool {
		if refs[i].version != refs[j].version {
			return refs[i].version < refs[j].version
		}
		if !refs[i].updatedAt.Equal(refs[j].updatedAt) {
			return refs[i].updatedAt.Before(refs[j].updatedAt)
		}
		if refs[i].kind != refs[j].kind {
			return refs[i].kind < refs[j].kind
		}
		return refs[i].index < refs[j].index
	})

	return refs
}

func trimChangesBySortedRefs(
	conversations []ConversationRecord,
	messages []MessageRecord,
	refs []changeRef,
	limit int,
) ([]ConversationRecord, []MessageRecord) {
	fetchLimit := min(limit, len(refs))
	conversationIndexes := make([]int, 0, min(fetchLimit, len(conversations)))
	messageIndexes := make([]int, 0, min(fetchLimit, len(messages)))
	for i := range fetchLimit {
		ref := refs[i]
		if ref.kind == 0 {
			conversationIndexes = append(conversationIndexes, ref.index)
		} else {
			messageIndexes = append(messageIndexes, ref.index)
		}
	}

	sort.Ints(conversationIndexes)
	sort.Ints(messageIndexes)
	return rowsByIndexes(conversations, conversationIndexes), rowsByIndexes(messages, messageIndexes)
}

func buildPullResponse(
	lastSyncVersion int32,
	conversations []ConversationRecord,
	messages []MessageRecord,
	hasMore bool,
	stateHash string,
) SyncPullResponse {
	return SyncPullResponse{
		Conversations: collections.Map(conversations, mapConversationToPayload),
		Messages:      collections.Map(messages, mapMessageToPayload),
		Deletions:     syncDeletionRecords(conversations, messages),
		LatestVersion: latestSyncVersion(lastSyncVersion, conversations, messages),
		HasMore:       hasMore,
		StateHash:     stateHash,
	}
}

func trimPullResponseToJSONBudget(
	lastSyncVersion int32,
	conversations []ConversationRecord,
	messages []MessageRecord,
	hasMore bool,
	stateHash string,
	budgetBytes int,
) (SyncPullResponse, bool, error) {
	response := buildPullResponse(lastSyncVersion, conversations, messages, hasMore, stateHash)
	if budgetBytes <= 0 || pullResponseFitsJSONBudget(response, budgetBytes) {
		return response, false, nil
	}

	totalChanges := len(conversations) + len(messages)
	if totalChanges > 1 {
		refs := sortedChangeRefs(conversations, messages)
		response, ok := trimPullResponseRowsToJSONBudget(
			lastSyncVersion,
			conversations,
			messages,
			refs,
			stateHash,
			budgetBytes,
			totalChanges,
		)
		if ok {
			return response, true, nil
		}

		conversations, messages = trimChangesBySortedRefs(conversations, messages, refs, 1)
	}

	if len(conversations)+len(messages) > 0 {
		singleChangeResponse := buildPullResponse(lastSyncVersion, conversations, messages, totalChanges > 1 || hasMore, stateHash)
		slog.Warn(
			"Sync pull single change exceeds payload budget",
			"lastSyncVersion",
			lastSyncVersion,
			"latestVersion",
			singleChangeResponse.LatestVersion,
			"budgetBytes",
			budgetBytes,
			"singleChangePayloadBytes",
			jsonPayloadSize(singleChangeResponse),
			"conversationCount",
			len(singleChangeResponse.Conversations),
			"messageCount",
			len(singleChangeResponse.Messages),
		)
		return SyncPullResponse{}, true, errSyncPullChangeExceedsBudget
	}
	return response, true, nil
}

func trimPullResponseRowsToJSONBudget(
	lastSyncVersion int32,
	conversations []ConversationRecord,
	messages []MessageRecord,
	refs []changeRef,
	stateHash string,
	budgetBytes int,
	totalChanges int,
) (SyncPullResponse, bool) {
	low := 1
	high := totalChanges - 1
	if high > math.MaxInt32 {
		high = math.MaxInt32
	}
	var best SyncPullResponse
	found := false

	for low <= high {
		limit := low + (high-low)/2
		candidateConvs, candidateMsgs := trimChangesBySortedRefs(conversations, messages, refs, limit)
		candidate := buildPullResponse(lastSyncVersion, candidateConvs, candidateMsgs, true, stateHash)
		if jsonPayloadSize(candidate) <= budgetBytes {
			best = candidate
			found = true
			low = limit + 1
			continue
		}
		high = limit - 1
	}

	return best, found
}

func jsonPayloadSize(response SyncPullResponse) int {
	payload, err := json.Marshal(response)
	if err != nil {
		return server.VercelFunctionPayloadLimitBytes + 1
	}
	return len(payload)
}

func pullResponseFitsJSONBudget(response SyncPullResponse, budgetBytes int) bool {
	if upperBound, ok := conservativePullResponseJSONUpperBound(response); ok && upperBound <= budgetBytes {
		return true
	}
	return jsonPayloadSize(response) <= budgetBytes
}

func conservativePullResponseJSONUpperBound(response SyncPullResponse) (int, bool) {
	total := 256 + jsonStringUpperBound(response.StateHash)
	total = addBounded(total, len(response.Conversations)*512)
	total = addBounded(total, len(response.Messages)*768)
	total = addBounded(total, len(response.Deletions)*256)

	for _, conversation := range response.Conversations {
		total = addBounded(total, jsonStringUpperBound(conversation.UserInput))
		total = addBounded(total, jsonStringPtrUpperBound(conversation.UserID))
		total = addBounded(total, jsonStringPtrUpperBound(conversation.Result))
		total = addBounded(total, jsonStringPtrUpperBound(conversation.Model))
		total = addBounded(total, jsonStringPtrUpperBound(conversation.DeviceID))
		total = addBounded(total, jsonByteStringUpperBound(conversation.VectorClock))
		total = addBounded(total, jsonByteStringUpperBound(conversation.Patches))
	}

	for _, message := range response.Messages {
		total = addBounded(total, jsonStringUpperBound(message.MessageID))
		total = addBounded(total, jsonStringUpperBound(message.Role))
		total = addBounded(total, jsonStringUpperBound(message.Content))
		total = addBounded(total, jsonStringPtrUpperBound(message.Error))
		total = addBounded(total, jsonStringPtrUpperBound(message.DeviceID))
		for _, value := range []any{message.Sources, message.ToolEvents, message.AgentStatuses, message.Trace} {
			size, ok := jsonAnyUpperBound(value)
			if !ok {
				return 0, false
			}
			total = addBounded(total, size)
		}
		total = addBounded(total, jsonByteStringUpperBound(message.VectorClock))
		total = addBounded(total, jsonByteStringUpperBound(message.Patches))
	}

	for _, deletion := range response.Deletions {
		total = addBounded(total, jsonStringUpperBound(deletion.Type))
		total = addBounded(total, jsonStringUpperBound(deletion.ID))
	}

	return total, total != math.MaxInt
}

func jsonAnyUpperBound(value any) (int, bool) {
	switch typed := value.(type) {
	case nil:
		return len("null"), true
	case json.RawMessage:
		if !json.Valid(typed) {
			return 0, false
		}
		return jsonRawMessageUpperBound(typed), true
	case []byte:
		return jsonByteStringUpperBound(typed), true
	case string:
		return jsonStringUpperBound(typed), true
	default:
		return 0, false
	}
}

func jsonRawMessageUpperBound(value json.RawMessage) int {
	return jsonRawMessageUpperBoundLength(len(value))
}

func jsonRawMessageUpperBoundLength(length int) int {
	if length > (math.MaxInt-2)/6 {
		return math.MaxInt
	}
	return addBounded(2, length*6)
}

func jsonStringPtrUpperBound(value *string) int {
	if value == nil {
		return len("null")
	}
	return jsonStringUpperBound(*value)
}

func jsonStringUpperBound(value string) int {
	return 2 + len(value)*6
}

func jsonByteStringUpperBound(value []byte) int {
	if len(value) == 0 {
		return 0
	}
	return 2 + ((len(value)+2)/3)*4
}

func addBounded(total int, value int) int {
	if value > math.MaxInt-total {
		return math.MaxInt
	}
	return total + value
}

type changeRef struct {
	kind      int
	index     int
	version   int32
	updatedAt time.Time
}

func rowsByIndexes[T any](rows []T, indexes []int) []T {
	out := make([]T, 0, len(indexes))
	for _, idx := range indexes {
		if idx >= 0 && idx < len(rows) {
			out = append(out, rows[idx])
		}
	}
	return out
}

func (s *Service) fetchChanges(ctx context.Context, userID string, req SyncPullRequest) ([]ConversationRecord, []MessageRecord, error) {
	limit := req.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	var wg sync.WaitGroup
	var convs []ConversationRecord
	var msgs []MessageRecord
	var convErr error
	var msgErr error
	wg.Add(2)

	if req.OrganizationID != nil {
		orgID := *req.OrganizationID
		go func() {
			defer wg.Done()
			convs, convErr = s.repo.GetConversationsByOrgAfterVersion(ctx, orgID, req.LastSyncVersion, limit+1)
		}()
		go func() {
			defer wg.Done()
			msgs, msgErr = s.repo.GetMessagesByOrgAfterVersion(ctx, orgID, req.LastSyncVersion, limit+1)
		}()
		wg.Wait()
		if convErr != nil {
			return nil, nil, fmt.Errorf("get conversations by org: %w", convErr)
		}
		if msgErr != nil {
			return nil, nil, fmt.Errorf("get messages by org: %w", msgErr)
		}
		return convs, msgs, nil
	}

	go func() {
		defer wg.Done()
		convs, convErr = s.repo.GetConversationsAfterVersion(ctx, userID, req.LastSyncVersion, limit+1)
	}()
	go func() {
		defer wg.Done()
		msgs, msgErr = s.repo.GetMessagesAfterVersion(ctx, userID, req.LastSyncVersion, limit+1)
	}()
	wg.Wait()
	if convErr != nil {
		return nil, nil, fmt.Errorf("get conversations: %w", convErr)
	}
	if msgErr != nil {
		return nil, nil, fmt.Errorf("get messages: %w", msgErr)
	}
	return convs, msgs, nil
}

func (s *Service) calculateStateHash(ctx context.Context, userID string, orgID *int32) (string, error) {
	convCount, msgCount, err := s.repo.GetSyncCounts(ctx, userID, orgID)
	if err != nil {
		return "", fmt.Errorf("get sync counts: %w", err)
	}

	return fmt.Sprintf("%d:%d", convCount, msgCount), nil
}
