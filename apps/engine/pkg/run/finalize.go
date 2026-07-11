package run

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/google/uuid"

	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	infracache "github.com/TaskForceAI/infrastructure/cache/pkg"
)

func loadExecutionTraceForResume(ctx context.Context, traceRepo *Repository, taskID string, trustUserID *int32) *orchestrator.ExecutionTrace {
	if traceRepo == nil {
		return nil
	}

	existingTrace, err := traceRepo.GetExecutionTrace(ctx, taskID)
	if err != nil {
		slog.Debug("[OrchestrateTask] No existing trace found for resumption", "taskId", taskID)
		return nil
	}

	if trustUserID == nil || existingTrace.UserID == nil || *existingTrace.UserID != *trustUserID {
		slog.Warn(
			"[OrchestrateTask] Existing trace ownership mismatch, skipping resume",
			"taskId", taskID,
			"traceId", existingTrace.ID,
			"traceUserId", existingTrace.UserID,
			"requestUserId", trustUserID,
		)
		return nil
	}

	slog.Info("[OrchestrateTask] Existing trace found, resuming", "taskId", taskID, "id", existingTrace.ID)
	return existingTrace
}

func finalizeTask(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	registry := GetRegistry()
	if state := registry.Get(taskID); state != nil && state.Status == StatusCanceled {
		recordCanceledTaskUsage(ctx, taskID, userID, opts, trace)
		slog.Info("[FinalizeTask] Skipping result persistence for canceled task", "taskId", taskID)
		return
	}
	finalizeActiveTask(ctx, registry, taskID, userID, prompt, modelID, result, trace, cfg, cacheInstance, skipCacheSet, memoryEnabled, opts, traceID)
}

func recordCanceledTaskUsage(ctx context.Context, taskID string, userID int, opts OrchestrateTaskOptions, trace *orchestrator.OrchestrationTrace) {
	if trace == nil {
		return
	}
	usageCtx := context.WithoutCancel(ctx)
	if err := RunTaskPersistenceTx(usageCtx, func(store taskPersistenceStore) error {
		recordTaskUsage(usageCtx, store, taskID, nil, userID, opts, trace)
		return nil
	}); err != nil {
		slog.Error("[FinalizeTask] Canceled task usage transaction failed", "taskId", taskID, "error", err)
	}
}

func finalizeActiveTask(ctx context.Context, registry TaskRegistrar, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	var completionErr string
	noRetention := opts.NoTraining && !opts.IsEval
	isMediaGenerationModel := isMediaGenerationModelID(modelID)
	skipCacheSave := skipCacheSet || opts.ComputerUseEnabled

	if noRetention {
		slog.Info("[FinalizeTask] Skipping cache, conversation persistence, and memory extraction due to no-training policy", "taskId", taskID)
		if err := completeTaskStatusWithConversationLockRetry(ctx, registry, taskID, result, "", 0, traceID); err != nil {
			slog.Error("[OrchestrateTask] Failed to persist final task state", "taskId", taskID, "error", err)
		}
		return
	}

	completionErr = saveFinalTaskCache(ctx, taskID, userID, prompt, modelID, result, cacheInstance, skipCacheSave, isMediaGenerationModel, opts)

	taskSnapshot := registry.Get(taskID)
	sourcesData, toolEventsData, agentStatusesData, metadataErr := buildMessageMetadata(taskSnapshot)
	if metadataErr != nil {
		slog.Warn("[FinalizeTask] Failed to marshal message metadata", "taskId", taskID, "error", metadataErr)
	}

	if err := completeTaskStatusWithConversationLockRetry(ctx, registry, taskID, result, "", 0, traceID); err != nil {
		slog.Error("[OrchestrateTask] Failed to persist early final task state", "taskId", taskID, "error", err)
	}

	conversationID, txErr := persistFinalTask(ctx, taskID, userID, prompt, modelID, result, trace, opts, sourcesData, toolEventsData, agentStatusesData)
	if txErr != nil {
		conversationID = 0
		completionErr = txErr.Error()
		slog.Error("[FinalizeTask] Database transaction failed", "taskId", taskID, "error", txErr)
	} else if memoryEnabled && !opts.IsEval {
		if isMediaGenerationModel {
			slog.Info("[FinalizeTask] Memory extraction skipped for media generation model", "taskId", taskID, "modelId", modelID)
		} else if memoryErr := extractFinalTaskMemories(ctx, taskID, cfg, userID, opts.OrgID, conversationID, prompt, result); memoryErr != "" {
			completionErr = memoryErr
		}
	}

	if err := completeTaskStatusWithConversationLockRetry(ctx, registry, taskID, result, completionErr, conversationID, traceID); err != nil {
		slog.Error("[OrchestrateTask] Failed to persist final task state", "taskId", taskID, "error", err)
	}
}

func saveFinalTaskCache(ctx context.Context, taskID string, userID int, prompt, modelID, result string, cacheInstance corecache.ICache, skipCacheSave, mediaModel bool, opts OrchestrateTaskOptions) string {
	if cacheInstance == nil {
		return ""
	}
	if mediaModel {
		slog.Info("[FinalizeTask] Cache save skipped for media generation model", "taskId", taskID, "modelId", modelID)
		return ""
	}
	if opts.ComputerUseEnabled {
		slog.Info("[FinalizeTask] Cache save skipped for computer use", "taskId", taskID)
		return ""
	}
	if skipCacheSave {
		return ""
	}
	cache := infracache.NewLLMCache(cacheInstance)
	if err := cache.SetScoped(ctx, runProfileKey(userID, opts.OrgID), prompt, cacheModelVariant(modelID, opts.ReasoningEffort), result, 24*time.Hour); err != nil {
		slog.Warn("[FinalizeTask] Cache save failed", "taskId", taskID, "error", err)
		return fmt.Sprintf("cache save failed: %v", err)
	}
	return ""
}

func persistFinalTask(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, opts OrchestrateTaskOptions, sourcesData, toolEventsData, agentStatusesData []byte) (int32, error) {
	var conversationID int32
	err := RunTaskPersistenceTx(ctx, func(store taskPersistenceStore) error {
		agentCount := opts.AgentCount
		if agentCount <= 0 {
			agentCount = 4
		}
		agentCount32 := int32(agentCount) // #nosec G115 -- agent counts are bounded by config preparation.
		conv, err := store.CreateConversation(ctx, taskConversationCreateInput{
			UserID:         userID,
			OrganizationID: opts.OrgID,
			UserInput:      prompt,
			Model:          modelID,
			AgentCount:     agentCount32,
			ProjectID:      opts.ProjectID,
		})
		if err != nil {
			return fmt.Errorf("create conversation: %w", err)
		}
		conversationID = conv.ID

		var traceData []byte
		if trace != nil {
			var marshalErr error
			traceData, marshalErr = marshalOrchestrationTrace(trace)
			if marshalErr != nil {
				return fmt.Errorf("marshal trace: %w", marshalErr)
			}
		}
		err = store.CreateMessage(ctx, taskMessageCreateInput{
			MessageID:      "msg_" + uuid.New().String(),
			ConversationID: conversationID,
			Role:           "assistant",
			Content:        result,
			Sources:        sourcesData,
			ToolEvents:     toolEventsData,
			AgentStatuses:  agentStatusesData,
			Trace:          traceData,
		})
		if err != nil {
			return fmt.Errorf("create message: %w", err)
		}

		recordTaskUsage(ctx, store, taskID, &conversationID, userID, opts, trace)

		return nil
	})
	return conversationID, err
}

func extractFinalTaskMemories(ctx context.Context, taskID string, cfg coreconfig.Config, userID int, orgID *int32, conversationID int32, prompt, result string) string {
	store, err := LoadMemoryStore(ctx)
	if err != nil {
		slog.Warn("[FinalizeTask] Could not load memory store for extraction", "taskId", taskID, "error", err)
		return ""
	}
	if err := ExtractAndSaveMemories(ctx, store, cfg, userID, orgID, &conversationID, prompt, result); err != nil {
		slog.Warn("[FinalizeTask] Memory extraction failed (non-fatal)", "taskId", taskID, "error", err)
		return fmt.Sprintf("memory extraction failed: %v", err)
	}
	return ""
}

func buildMessageMetadata(task *TaskState) ([]byte, []byte, []byte, error) {
	if task == nil {
		return nil, nil, nil, nil
	}

	var firstErr error
	marshal := func(value any) []byte {
		if value == nil {
			return nil
		}
		data, err := json.Marshal(value)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			return nil
		}
		return data
	}

	sources, hasSourcesSnapshot := extractSourcesFromToolEvents(task.ToolEvents)
	toolEventsData := marshal(task.ToolEvents)
	agentStatusesData := marshal(task.AgentStatuses)
	if !hasSourcesSnapshot {
		sources = extractSourcesFromToolEventsData(toolEventsData)
	}
	sourcesData := marshal(sources)

	return sourcesData, toolEventsData, agentStatusesData, firstErr
}

func recordTaskUsage(ctx context.Context, store taskPersistenceStore, taskID string, conversationID *int32, userID int, opts OrchestrateTaskOptions, trace *orchestrator.OrchestrationTrace) {
	if store == nil || trace == nil {
		return
	}
	var conversationIDInt *int
	if conversationID != nil {
		value := int(*conversationID)
		conversationIDInt = &value
	}
	userIDString := strconv.Itoa(userID)
	userIDPtr := &userIDString
	plan := strings.TrimSpace(opts.UserPlan)
	var planPtr *string
	if plan != "" {
		planPtr = &plan
	}
	var orgIDPtr *int
	if opts.OrgID != nil {
		orgID := int(*opts.OrgID)
		orgIDPtr = &orgID
	}

	tokenRecords := make([]sharedusage.TokenUsageRecord, 0, len(trace.TokenUsage))
	for _, record := range trace.TokenUsage {
		tokenRecords = append(tokenRecords, sharedusage.TokenUsageRecord{
			Model:            record.Model,
			Stage:            record.Stage,
			PromptTokens:     record.PromptTokens,
			CompletionTokens: record.CompletionTokens,
			TotalTokens:      record.TotalTokens,
			CachedTokens:     record.CachedTokens,
		})
	}
	if err := sharedusage.NewTokenUsageRecorder(store, nil).RecordTokenUsage(ctx, sharedusage.RecordTokenUsageParams{
		TaskID:         taskID,
		ConversationID: conversationIDInt,
		UserID:         userIDPtr,
		OrganizationID: orgIDPtr,
		Plan:           planPtr,
		Records:        tokenRecords,
	}); err != nil {
		slog.Warn("[FinalizeTask] Failed to record token usage", "taskId", taskID, "conversationId", conversationID, "error", err)
	}

	toolRecords := make([]sharedusage.ToolUsageRecord, 0, len(trace.ToolUsage))
	for _, event := range trace.ToolUsage {
		if strings.TrimSpace(event.ToolName) == "" {
			continue
		}
		var agentID *string
		if event.AgentID != nil {
			value := strconv.Itoa(*event.AgentID)
			agentID = &value
		}
		var agentLabel *string
		if label := strings.TrimSpace(event.AgentLabel); label != "" {
			agentLabel = &label
		}
		var resultPreview *string
		if preview := strings.TrimSpace(event.ResultPreview); preview != "" {
			resultPreview = &preview
		}
		var errText *string
		if event.Error != "" {
			errText = &event.Error
		}
		toolRecords = append(toolRecords, sharedusage.ToolUsageRecord{
			ToolName:   event.ToolName,
			Success:    event.Success || strings.EqualFold(event.Status, "completed"),
			Duration:   int(event.DurationMs),
			Error:      errText,
			AgentID:    agentID,
			AgentLabel: agentLabel,
			Output:     resultPreview,
		})
	}
	if err := sharedusage.NewToolUsageRecorder(store, nil).RecordToolUsage(ctx, sharedusage.RecordToolUsageParams{
		TaskID:         taskID,
		ConversationID: conversationIDInt,
		UserID:         userIDPtr,
		OrganizationID: orgIDPtr,
		Plan:           planPtr,
		Records:        toolRecords,
	}); err != nil {
		slog.Warn("[FinalizeTask] Failed to record tool usage", "taskId", taskID, "conversationId", conversationID, "error", err)
	}
}

type messageSource struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

func extractSourcesFromToolEventsData(data []byte) []messageSource {
	if len(data) == 0 {
		return nil
	}
	var events []struct {
		Sources []messageSource `json:"sources"`
	}
	if err := json.Unmarshal(data, &events); err != nil {
		return nil
	}
	seen := map[string]struct{}{}
	sources := []messageSource{}
	for _, event := range events {
		for _, source := range event.Sources {
			if source.URL == "" {
				continue
			}
			if _, ok := seen[source.URL]; ok {
				continue
			}
			seen[source.URL] = struct{}{}
			sources = append(sources, source)
		}
	}
	return sources
}

func extractSourcesFromToolEvents(value any) ([]messageSource, bool) {
	switch events := value.(type) {
	case nil:
		return nil, true
	case []agent.ToolEvent:
		sources := make([]messageSource, 0)
		seen := make(map[string]struct{})
		for _, event := range events {
			for _, source := range event.Sources {
				sources = appendSourceReference(sources, seen, source.URL, source.Title, source.Snippet)
			}
		}
		return sources, true
	case []map[string]any:
		return extractSourcesFromMapEvents(events), true
	case []any:
		return extractSourcesFromAnyMapEvents(events)
	default:
		return nil, false
	}
}

func extractSourcesFromMapEvents(events []map[string]any) []messageSource {
	sources := make([]messageSource, 0)
	seen := make(map[string]struct{})
	for _, event := range events {
		rawSources, ok := event["sources"]
		if !ok {
			continue
		}
		sources = appendSourcesFromValue(sources, seen, rawSources)
	}
	return sources
}

func extractSourcesFromAnyMapEvents(events []any) ([]messageSource, bool) {
	sources := make([]messageSource, 0)
	seen := make(map[string]struct{})
	for _, event := range events {
		eventMap, ok := event.(map[string]any)
		if !ok {
			return nil, false
		}
		rawSources, ok := eventMap["sources"]
		if !ok {
			continue
		}
		sources = appendSourcesFromValue(sources, seen, rawSources)
	}
	return sources, true
}

func appendSourcesFromValue(sources []messageSource, seen map[string]struct{}, raw any) []messageSource {
	switch values := raw.(type) {
	case []map[string]string:
		for _, source := range values {
			sources = appendSourceReference(sources, seen, source["url"], source["title"], source["snippet"])
		}
	case []map[string]any:
		for _, source := range values {
			sources = appendSourceReference(sources, seen, stringMapValue(source, "url"), stringMapValue(source, "title"), stringMapValue(source, "snippet"))
		}
	case []any:
		for _, item := range values {
			source, ok := item.(map[string]any)
			if !ok {
				continue
			}
			sources = appendSourceReference(sources, seen, stringMapValue(source, "url"), stringMapValue(source, "title"), stringMapValue(source, "snippet"))
		}
	}
	return sources
}

func appendSourceReference(sources []messageSource, seen map[string]struct{}, url, title, snippet string) []messageSource {
	if url == "" {
		return sources
	}
	if _, ok := seen[url]; ok {
		return sources
	}
	seen[url] = struct{}{}
	return append(sources, messageSource{
		URL:     url,
		Title:   title,
		Snippet: snippet,
	})
}

func stringMapValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}
