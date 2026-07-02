import { ok } from '@taskforceai/shared/result';

import { runLatencyBenchmarkSuite, sleepMs } from '../../../scripts/perf/latency-benchmark';
import { submitPrompt } from '../app/lib/prompt/submit-prompt';

await runLatencyBenchmarkSuite('web submit-to-stream P1', [
  {
    name: 'submit-to-stream-start',
    run: async () => {
      let streamStarted = false;
      const result = await submitPrompt({
        prompt: 'Summarize this conversation',
        attachment_ids: ['attachment-a'],
        modelId: 'openai/gpt-5.5',
        projectId: 7,
        userPlan: 'pro',
        computerUseEnabled: true,
        useLoggedInServices: true,
        quickModeEnabled: false,
        autonomyEnabled: true,
        budget: 10,
        agentCount: 3,
        ensureConversationId: async () => 'conversation-1',
        enqueuePrompt: async () => {},
        prepareStreaming: () => {},
        failPreparedStreaming: () => {},
        startStreaming: async () => {
          await sleepMs(1);
          streamStarted = true;
        },
        onSendMessage: () => {},
        onConversationId: () => {},
        onApproval: () => {},
        buildRateLimitMessage: () => 'rate limited',
        readRateLimitResetTime: () => undefined,
        isOffline: () => false,
        runTask: async () => {
          await sleepMs(1);
          return ok({ task_id: 'task-1', status: 'queued' });
        },
      });

      if (!result.ok || !streamStarted) {
        throw new Error('submitPrompt did not reach stream start');
      }
    },
  },
]);
