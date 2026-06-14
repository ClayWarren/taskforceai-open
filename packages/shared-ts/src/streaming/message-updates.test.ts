import { describe, expect, it } from 'bun:test';

import {
  applyStreamingErrorMessage,
  finalizeStreamingMessages,
  updateStreamingContentAndStatusMessages,
  type StreamingMessageLike,
} from './message-updates';

type TestMessage = StreamingMessageLike<string, string, string> & { trace_id?: string };

describe('streaming message update helpers', () => {
  it('updates existing streaming content and status messages', () => {
    const messages: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
      },
      {
        id: 'content',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: false,
      },
    ];

    expect(
      updateStreamingContentAndStatusMessages(messages, {
        ids: { statusMessageId: 'status', contentMessageId: 'content' },
        content: 'partial',
        agentStatuses: ['running'],
        elapsedSeconds: 3,
        toolEvents: ['tool'],
        timestamp: 123,
      })
    ).toEqual([
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
        agentStatuses: ['running'],
        elapsedSeconds: 3,
        toolEvents: ['tool'],
        updatedAt: 123,
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
        updatedAt: 123,
      },
    ]);
  });

  it('inserts missing streaming placeholders while applying content', () => {
    expect(
      updateStreamingContentAndStatusMessages<TestMessage>([], {
        ids: { statusMessageId: 'status', contentMessageId: 'content' },
        content: 'partial',
        agentStatuses: [],
        elapsedSeconds: 0,
        toolEvents: [],
        timestamp: 123,
      })
    ).toEqual([
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
        toolEvents: [],
        agentStatuses: [],
        elapsedSeconds: 0,
        createdAt: 123,
        updatedAt: 123,
        sources: [],
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
        toolEvents: [],
        createdAt: 123,
        updatedAt: 123,
        sources: [],
      },
    ]);
  });

  it('finalizes status and content messages', () => {
    const messages: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
      },
    ];

    expect(
      finalizeStreamingMessages(
        messages,
        { statusMessageId: 'status', contentMessageId: 'content' },
        {
          finalResponse: 'done',
          sources: ['source'],
          toolEvents: ['tool'],
          elapsedSeconds: 4,
          agentStatuses: ['complete'],
          updatedAt: 456,
          traceId: 'trace',
        }
      )
    ).toEqual([
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: false,
        isAgentStatus: true,
        elapsedSeconds: 4,
        toolEvents: ['tool'],
        agentStatuses: ['complete'],
        trace_id: 'trace',
        updatedAt: 456,
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'done',
        isStreaming: false,
        isAgentStatus: false,
        elapsedSeconds: 4,
        sources: ['source'],
        toolEvents: [],
        trace_id: 'trace',
        updatedAt: 456,
      },
    ]);
  });

  it('copies generated file tool events to the finalized content message', () => {
    type GeneratedFileTool = {
      toolName: string;
      generatedFile?: { filename: string; downloadUrl?: string };
    };
    type GeneratedFileMessage = StreamingMessageLike<string, GeneratedFileTool, string>;
    const generatedFileEvent: GeneratedFileTool = {
      toolName: 'create_spreadsheet',
      generatedFile: {
        filename: 'sunlight-planets.xlsx',
        downloadUrl: '/api/v1/developer/files/file-1/content',
      },
    };
    const messages: GeneratedFileMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
      },
    ];

    const finalized = finalizeStreamingMessages(
      messages,
      { statusMessageId: 'status', contentMessageId: 'content' },
      {
        finalResponse: 'done',
        sources: [] as string[],
        toolEvents: [{ toolName: 'execute_code' }, generatedFileEvent],
        elapsedSeconds: 4,
        agentStatuses: ['complete'],
      }
    );

    expect(finalized.find((message) => message.id === 'content')?.toolEvents).toEqual([
      generatedFileEvent,
    ]);
    expect(finalized.find((message) => message.id === 'status')?.toolEvents).toEqual([
      { toolName: 'execute_code' },
      generatedFileEvent,
    ]);
  });

  it('clears non-generated live tool events from the finalized content message', () => {
    type ToolEvent = { toolName: string };
    type Message = StreamingMessageLike<string, ToolEvent, string>;
    const messages: Message[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
        toolEvents: [{ toolName: 'search_web' }],
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
        toolEvents: [{ toolName: 'search_web' }],
      },
    ];

    const finalized = finalizeStreamingMessages(
      messages,
      { statusMessageId: 'status', contentMessageId: 'content' },
      {
        finalResponse: 'done',
        sources: [] as string[],
        toolEvents: [{ toolName: 'search_web' }],
        elapsedSeconds: 4,
        agentStatuses: ['complete'],
      }
    );

    expect(finalized.find((message) => message.id === 'content')?.toolEvents).toEqual([]);
    expect(finalized.find((message) => message.id === 'status')?.toolEvents).toEqual([
      { toolName: 'search_web' },
    ]);
  });

  it('applies streaming error to the latest matching content message', () => {
    const messages: TestMessage[] = [
      { id: 'content', role: 'assistant', content: 'old', isStreaming: true, sources: ['source'] },
    ];

    expect(
      applyStreamingErrorMessage(messages, 'content', 'failed', { clearSources: true })
    ).toEqual([
      {
        id: 'content',
        role: 'assistant',
        content: 'failed',
        isStreaming: false,
        error: 'failed',
        sources: [],
      },
    ]);
  });
});
