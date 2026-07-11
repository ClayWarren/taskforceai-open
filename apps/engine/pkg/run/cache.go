package run

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	corecache "github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	infracache "github.com/TaskForceAI/infrastructure/cache/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func getCacheInstance() corecache.ICache {
	redisClient, _ := RedisClientGetter()
	if redisClient == nil {
		return nil
	}
	if CacheFactory != nil {
		return CacheFactory(redisClient)
	}
	return infracache.NewRedisCacheWithClient(redisCmdableCacheAdapter{client: redisClient})
}

// redisCmdableCacheAdapter bridges the Redis adapter Cmdable contract to the
// cache adapter client contract.
type redisCmdableCacheAdapter struct {
	client redis.Cmdable
}

func (a redisCmdableCacheAdapter) Get(ctx context.Context, key string) (string, bool, error) {
	val, err := a.client.Get(ctx, key)
	if err != nil {
		if isRedisKeyNotFoundError(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return val, true, nil
}

func (a redisCmdableCacheAdapter) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return a.client.Set(ctx, key, value, ttl)
}

func (a redisCmdableCacheAdapter) Del(ctx context.Context, key string) (bool, error) {
	return a.client.Del(ctx, key)
}

func (a redisCmdableCacheAdapter) GetDel(ctx context.Context, key string) (string, bool, error) {
	// Cmdable does not currently expose atomic GETDEL, so we provide best-effort
	// behavior using GET followed by DEL.
	val, found, err := a.Get(ctx, key)
	if err != nil || !found {
		return "", found, err
	}
	deleted, delErr := a.client.Del(ctx, key)
	if delErr != nil {
		return "", false, delErr
	}
	if !deleted {
		return "", false, nil
	}
	return val, true, nil
}
func checkLLMCache(ctx context.Context, taskID string, userID int, prompt, modelID string, optArgs ...OrchestrateTaskOptions) (string, corecache.ICache, bool) {
	var opts OrchestrateTaskOptions
	if len(optArgs) > 0 {
		opts = optArgs[0]
	}
	requiresCurrentData := orchestrator.RequiresCurrentData(prompt)
	cacheInstance := getCacheInstance()

	if cacheInstance == nil {
		recordCacheDecision(ctx, "disabled")
		return "", nil, requiresCurrentData
	}

	if opts.NoTraining && !opts.IsEval {
		slog.Info("[OrchestrateTask] Cache SKIPPED (no-training policy)", "taskId", taskID)
		recordCacheDecision(ctx, "skipped_no_training")
		return "", cacheInstance, requiresCurrentData
	}

	if opts.ComputerUseEnabled {
		slog.Info("[OrchestrateTask] Cache SKIPPED (computer use)", "taskId", taskID)
		recordCacheDecision(ctx, "skipped_computer_use")
		return "", cacheInstance, true
	}

	if orchestrator.IsGeneratedFileRequest(prompt) {
		slog.Info("[OrchestrateTask] Cache SKIPPED (generated file request)", "taskId", taskID)
		recordCacheDecision(ctx, "skipped_generated_file")
		return "", cacheInstance, false
	}

	if requiresCurrentData {
		slog.Info("[OrchestrateTask] Cache SKIPPED (requires current data)", "taskId", taskID)
		recordCacheDecision(ctx, "skipped_current_data")
		return "", cacheInstance, true
	}

	if isMediaGenerationModelID(modelID) {
		slog.Info("[OrchestrateTask] Cache SKIPPED (media generation model)", "taskId", taskID, "modelId", modelID)
		recordCacheDecision(ctx, "skipped_media_generation")
		return "", cacheInstance, false
	}

	lCache := infracache.NewLLMCache(cacheInstance)
	result, err := lCache.GetScoped(ctx, runProfileKey(userID, opts.OrgID), prompt, cacheModelVariant(modelID, opts.ReasoningEffort))
	if err != nil {
		if errors.Is(err, infracache.ErrNotFound) {
			recordCacheDecision(ctx, "miss")
			return "", cacheInstance, false
		}
		slog.Error("[OrchestrateTask] Cache read failed", "taskId", taskID, "error", err)
		recordCacheDecision(ctx, "error")
		return "", cacheInstance, false
	}
	if result == "" {
		recordCacheDecision(ctx, "miss")
		return "", cacheInstance, false
	}

	// Ignore cached failures to allow recovery
	failures := []string{
		"Maximum iterations reached",
		"\\boxed",
		"Final Answer: None",
		"no relevant or verifiable information could be identified",
		"no relevant or reliable information was available",
		"unable to gather sufficient information",
		"don't have the ability to generate images",
		"cannot generate images",
		"unable to create images",
		"don't have the ability to generate videos",
		"cannot generate videos",
		"unable to create videos",
	}

	for _, f := range failures {
		if strings.Contains(result, f) {
			slog.Info("[OrchestrateTask] Ignoring stale or failure cache result", "taskId", taskID)
			recordCacheDecision(ctx, "ignored_stale")
			return "", cacheInstance, false
		}
	}

	slog.Info("[OrchestrateTask] Cache hit", "taskId", taskID)
	recordCacheDecision(ctx, "hit")
	return result, cacheInstance, false
}

func cacheModelVariant(modelID, reasoningEffort string) string {
	reasoningEffort = strings.ToLower(strings.TrimSpace(reasoningEffort))
	if reasoningEffort == "" {
		return modelID
	}
	return modelID + "#reasoning=" + reasoningEffort
}
