package run

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"time"
)

const defaultAIGatewayBaseURL = "https://ai-gateway.vercel.sh/v1"
const sentinelIdentityReply = "I'm Sentinel, TaskForceAI's assistant."

var orchestrateTaskHeartbeatIntervalNanos = (10 * time.Second).Nanoseconds()

func getOrchestrateTaskHeartbeatInterval() time.Duration {
	return time.Duration(atomic.LoadInt64(&orchestrateTaskHeartbeatIntervalNanos))
}

// marshalOrchestrationTrace serializes orchestration traces for persistence.
var marshalOrchestrationTrace = json.Marshal

func OrchestrateTask(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
	runner := newOrchestrateTaskRunner(taskID, userID, prompt, modelID, opts, GetRegistry())
	runner.run(ctx)
}
