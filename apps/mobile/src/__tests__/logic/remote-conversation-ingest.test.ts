import { describe, expect, it } from 'bun:test';

import { createRemoteConversationIngestPlan } from '../../storage/remote-conversation-ingest';
import type { LocalMessage } from '../../storage/chat-local-mobile.internal';

describe('remote conversation ingest plan', () => {
  it('builds stable local messages from a remote conversation summary', () => {
    const plan = createRemoteConversationIngestPlan(
      {
        id: 'run-1',
        timestamp: '2026-06-13T12:34:56.000Z',
        user_input: 'Summarize the logs',
        result: 'The logs are clean.',
        execution_time: 2.6,
        sources: [{ title: 'Run log', url: 'https://example.com/log' }],
        agentStatuses: [{ agent: 'researcher', status: 'completed', message: 'Done' }],
      } as any,
      []
    );

    expect(plan.remoteConversationId).toBe('remote-run-1');
    expect(plan.userMessage).toMatchObject({
      conversationId: 'remote-run-1',
      messageId: 'remote-run-1-user',
      role: 'user',
      content: 'Summarize the logs',
      isStreaming: false,
    });
    expect(plan.agentStatusMessage).toMatchObject({
      messageId: 'remote-run-1-agent-status',
      role: 'assistant',
      isAgentStatus: true,
      elapsedSeconds: 3,
    });
    expect(plan.agentStatusMessage.sources).toEqual([{ title: 'Run log', url: 'https://example.com/log' }]);
    expect(plan.agentStatusMessage.agentStatuses).toEqual([
      { agent: 'researcher', status: 'completed', message: 'Done' },
    ]);
    expect(plan.assistantMessage).toMatchObject({
      messageId: 'remote-run-1-assistant',
      role: 'assistant',
      content: 'The logs are clean.',
      isAgentStatus: false,
      sources: [{ title: 'Run log', url: 'https://example.com/log' }],
    });
  });

  it('preserves existing status metadata when the remote summary omits it', () => {
    const existingMessages = [
      {
        messageId: 'remote-run-2-agent-status',
        sources: [{ title: 'Existing source', url: 'https://example.com/source' }],
        toolEvents: [{ type: 'tool_call', name: 'search', status: 'completed' }],
        agentStatuses: [{ agent: 'writer', status: 'running', message: 'Drafting' }],
      },
      {
        messageId: 'remote-run-2-assistant',
        toolEvents: [{ type: 'tool_result', name: 'search', status: 'completed' }],
      },
    ] as LocalMessage[];

    const plan = createRemoteConversationIngestPlan(
      {
        id: 'run-2',
        timestamp: '2026-06-13T12:34:56.000Z',
        user_input: null,
        result: null,
      } as any,
      existingMessages
    );

    expect(plan.userMessage.content).toBe('');
    expect(plan.agentStatusMessage.sources).toEqual([
      { title: 'Existing source', url: 'https://example.com/source' },
    ]);
    expect(plan.agentStatusMessage.toolEvents).toEqual([
      { type: 'tool_call', name: 'search', status: 'completed' },
    ]);
    expect(plan.agentStatusMessage.agentStatuses).toEqual([
      { agent: 'writer', status: 'running', message: 'Drafting' },
    ]);
    expect(plan.assistantMessage.content).toBe('');
    expect(plan.assistantMessage.sources).toEqual([
      { title: 'Existing source', url: 'https://example.com/source' },
    ]);
    expect(plan.assistantMessage.toolEvents).toEqual([
      { type: 'tool_result', name: 'search', status: 'completed' },
    ]);
  });
});
