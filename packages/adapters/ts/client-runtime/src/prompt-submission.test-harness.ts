import { vi } from 'bun:test';
import { ok } from '@taskforceai/client-core/result';

import type { SubmitStreamingPromptParams } from './prompt-submission';

export const createSubmitStreamingParams = (
  overrides: Partial<SubmitStreamingPromptParams> = {}
): SubmitStreamingPromptParams => ({
  prompt: 'hello',
  attachment_ids: [],
  modelId: 'model-1',
  role_models: { Researcher: 'model-2' },
  projectId: 3,
  userPlan: 'free',
  computerUseEnabled: true,
  useLoggedInServices: true,
  quickModeEnabled: false,
  autonomyEnabled: true,
  budget: 5,
  agentCount: 4,
  ensureConversationId: vi.fn().mockResolvedValue('local-conversation'),
  enqueuePrompt: vi.fn().mockResolvedValue(undefined),
  prepareStreaming: vi.fn(),
  failPreparedStreaming: vi.fn(),
  startStreaming: vi.fn().mockResolvedValue(undefined),
  onSendMessage: vi.fn(),
  onConversationId: vi.fn(),
  onApproval: vi.fn(),
  buildRateLimitMessage: vi.fn().mockReturnValue('Rate limited'),
  readRateLimitResetTime: vi.fn().mockReturnValue('2030-01-01'),
  isOffline: vi.fn().mockReturnValue(false),
  runTask: vi.fn().mockResolvedValue(ok({ task_id: 'task-1' })),
  logger: { warn: vi.fn() },
  ...overrides,
});
