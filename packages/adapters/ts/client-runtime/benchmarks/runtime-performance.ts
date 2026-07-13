import { ok } from '@taskforceai/client-core/result';

import {
  runOperationBenchmarkSuite,
  type OperationBenchmarkCase,
} from '../../../../../scripts/perf/operation-benchmark';
import { hydrateMessageRecords, resolvePromptContent, submitStreamingPrompt } from '../src';
import { extractQueuedRunPayloadMetadata } from '../src/queued-run-payload';
import type { MessageRecord } from '../src/types';

let checksum = 0;

const makeMessageRecords = (count: number): MessageRecord[] => {
  const records: MessageRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    records.push({
      messageId: `message-${index}`,
      conversationId: `conversation-${index % 10}`,
      role: index % 3 === 0 ? 'assistant' : 'user',
      content: `Message content ${index}`,
      isStreaming: index % 11 === 0,
      isAgentStatus: index % 17 === 0,
      isLocalCommandOutput: index % 19 === 0,
      elapsedSeconds: index % 7,
      createdAt: 1_700_000_000_000 + index,
      updatedAt: 1_700_000_500_000 + index,
      trace_id: index % 5 === 0 ? `trace-${index}` : undefined,
      sources:
        index % 4 === 0
          ? [{ title: `Source ${index}`, url: `https://example.com/${index}` }]
          : undefined,
      toolEvents:
        index % 6 === 0
          ? [
              {
                toolName: 'search',
                agentLabel: 'researcher',
                arguments: { query: `query ${index}` },
                success: true,
                durationMs: index,
              },
            ]
          : undefined,
      agentStatuses:
        index % 8 === 0
          ? [
              {
                agent_id: index % 4,
                status: 'COMPLETE',
                progress: 1,
              },
            ]
          : undefined,
    });
  }
  return records;
};

const messageRecords = makeMessageRecords(1000);

const queuedPayloads = Array.from({ length: 1000 }, (_unused, index) => ({
  modelId: index % 2 === 0 ? `model-${index % 7}` : '',
  attachment_ids:
    index % 3 === 0 ? [`attachment-${index}`, index, null, `attachment-${index + 1}`] : undefined,
  attachmentIds: index % 3 === 1 ? [`legacy-${index}`, false, `legacy-${index + 1}`] : undefined,
}));

const promptInputs = Array.from({ length: 1000 }, (_unused, index) => ({
  content: index % 4 === 0 ? '   ' : `Prompt ${index}`,
  attachmentIds: index % 4 === 0 ? [`attachment-${index}`] : [],
}));

const runHydrateMessages = (): void => {
  const messages = hydrateMessageRecords(messageRecords);
  checksum += messages.length;
  checksum += messages[0]?.sources?.length ?? 0;
  checksum += messages[999]?.agentStatuses?.length ?? 0;
};

const runExtractQueuedPayloadMetadata = (): void => {
  let localChecksum = 0;
  for (const payload of queuedPayloads) {
    const metadata = extractQueuedRunPayloadMetadata(payload);
    localChecksum += metadata.modelId?.length ?? 0;
    localChecksum += metadata.attachmentIds?.length ?? 0;
  }
  checksum += localChecksum;
};

const runResolvePromptContent = (): void => {
  let localChecksum = 0;
  for (const input of promptInputs) {
    const resolved = resolvePromptContent(input.content, input.attachmentIds);
    localChecksum += resolved.promptForTask.length + resolved.displayContent.length;
  }
  checksum += localChecksum;
};

const runSubmitStreamingPrompt = async (): Promise<void> => {
  const result = await submitStreamingPrompt({
    prompt: 'Analyze the project state and produce a plan',
    attachment_ids: ['attachment-a', 'attachment-b'],
    modelId: 'openai/gpt-5.6-sol',
    role_models: {
      planner: 'openai/gpt-5.6-sol',
      researcher: 'anthropic/claude-sonnet-5',
      engineer: 'openai/gpt-5.5-codex',
      reviewer: 'anthropic/claude-opus-5',
    },
    projectId: 42,
    userPlan: 'pro',
    computerUseEnabled: true,
    useLoggedInServices: true,
    quickModeEnabled: false,
    autonomyEnabled: true,
    budget: 12.5,
    agentCount: 4,
    ensureConversationId: async () => 'conversation-1',
    enqueuePrompt: async () => {},
    prepareStreaming: () => {},
    failPreparedStreaming: () => {},
    startStreaming: async () => {},
    onSendMessage: () => {},
    onConversationId: () => {},
    onApproval: () => {},
    buildRateLimitMessage: () => 'rate limited',
    readRateLimitResetTime: () => undefined,
    isOffline: () => false,
    runTask: async () => ok({ task_id: 'task-1', status: 'queued' }),
    logger: {
      warn: () => {},
    },
  });
  checksum += result.ok ? 1 : 0;
};

const cases: OperationBenchmarkCase[] = [
  {
    name: 'hydrate-message-records',
    operationsPerIteration: messageRecords.length,
    iterations: 1000,
    run: runHydrateMessages,
  },
  {
    name: 'extract-queued-run-payload-metadata',
    operationsPerIteration: queuedPayloads.length,
    iterations: 1500,
    run: runExtractQueuedPayloadMetadata,
  },
  {
    name: 'resolve-prompt-content',
    operationsPerIteration: promptInputs.length,
    iterations: 2000,
    run: runResolvePromptContent,
  },
  {
    name: 'submit-streaming-prompt',
    operationsPerIteration: 1,
    iterations: 1000,
    run: runSubmitStreamingPrompt,
  },
];

await runOperationBenchmarkSuite('client-runtime', cases);

console.log(`checksum=${checksum}`);
