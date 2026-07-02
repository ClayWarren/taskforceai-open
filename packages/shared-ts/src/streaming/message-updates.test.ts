import { describe, expect, it, vi } from 'bun:test';

import {
  applyStreamingErrorMessage,
  extractGeneratedFileToolEvents,
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

  it('inserts only the missing streaming placeholder when one message already exists', () => {
    const withStatusOnly: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
      },
    ];
    const withContentOnly: TestMessage[] = [
      {
        id: 'content',
        role: 'assistant',
        content: 'old',
        isStreaming: true,
        isAgentStatus: false,
      },
    ];

    const statusOnlyResult = updateStreamingContentAndStatusMessages(withStatusOnly, {
      ids: { statusMessageId: 'status', contentMessageId: 'content' },
      content: 'partial',
      agentStatuses: ['running'],
      elapsedSeconds: 2,
      toolEvents: ['tool'],
      timestamp: 321,
    });
    const contentOnlyResult = updateStreamingContentAndStatusMessages(withContentOnly, {
      ids: { statusMessageId: 'status', contentMessageId: 'content' },
      content: 'partial',
      agentStatuses: ['running'],
      elapsedSeconds: 2,
      toolEvents: ['tool'],
      timestamp: 321,
    });

    expect(statusOnlyResult).toHaveLength(2);
    expect(statusOnlyResult[0]).toEqual({
      id: 'status',
      role: 'assistant',
      content: '',
      isStreaming: true,
      isAgentStatus: true,
      agentStatuses: ['running'],
      elapsedSeconds: 2,
      toolEvents: ['tool'],
      updatedAt: 321,
    });
    expect(statusOnlyResult[1]).toEqual(
      expect.objectContaining({
        id: 'content',
        content: 'partial',
        isAgentStatus: false,
        createdAt: 321,
      })
    );

    expect(contentOnlyResult).toHaveLength(2);
    expect(contentOnlyResult[0]).toEqual({
      id: 'content',
      role: 'assistant',
      content: 'partial',
      isStreaming: true,
      isAgentStatus: false,
      updatedAt: 321,
    });
    expect(contentOnlyResult[1]).toEqual(
      expect.objectContaining({
        id: 'status',
        isAgentStatus: true,
        toolEvents: ['tool'],
        agentStatuses: ['running'],
        elapsedSeconds: 2,
        createdAt: 321,
      })
    );
  });

  it('preserves unrelated messages and uses Date.now when no timestamp is supplied', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(987);
    try {
      const messages: TestMessage[] = [
        {
          id: 'unrelated',
          role: 'user',
          content: 'keep',
        },
      ];

      const updated = updateStreamingContentAndStatusMessages(messages, {
        ids: { statusMessageId: 'status', contentMessageId: 'content' },
        content: 'partial',
        agentStatuses: ['running'],
        elapsedSeconds: 2,
        toolEvents: ['tool'],
      });

      expect(updated[0]).toBe(messages[0]);
      expect(updated.slice(1)).toEqual([
        {
          id: 'status',
          role: 'assistant',
          content: '',
          isStreaming: true,
          isAgentStatus: true,
          toolEvents: ['tool'],
          agentStatuses: ['running'],
          elapsedSeconds: 2,
          createdAt: 987,
          updatedAt: 987,
          sources: [],
        },
        {
          id: 'content',
          role: 'assistant',
          content: 'partial',
          isStreaming: true,
          isAgentStatus: false,
          toolEvents: [],
          createdAt: 987,
          updatedAt: 987,
          sources: [],
        },
      ]);
    } finally {
      nowSpy.mockRestore();
    }
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

  it('extracts only truthy generated file tool events', () => {
    const generated = { toolName: 'create_file', generatedFile: { filename: 'report.pdf' } };

    expect(
      extractGeneratedFileToolEvents([
        generated,
        { toolName: 'search_web' },
        { toolName: 'empty_generated', generatedFile: null },
        null,
        'not-an-event',
      ])
    ).toEqual([generated]);
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

  it('finalizes trace id to undefined when payload explicitly clears it', () => {
    const messages: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
        trace_id: 'old-trace',
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
        trace_id: 'old-trace',
      },
    ];

    const finalized = finalizeStreamingMessages(
      messages,
      { statusMessageId: 'status', contentMessageId: 'content' },
      {
        finalResponse: 'done',
        sources: [] as string[],
        toolEvents: [] as string[],
        elapsedSeconds: 5,
        agentStatuses: [] as string[],
        traceId: null,
      }
    );

    expect(finalized).toEqual([
      expect.objectContaining({ id: 'status', trace_id: undefined }),
      expect.objectContaining({ id: 'content', trace_id: undefined }),
    ]);
  });

  it('preserves existing trace id and updated timestamp when final payload omits optional fields', () => {
    const messages: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
        trace_id: 'status-trace',
        updatedAt: 111,
      },
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
        trace_id: 'content-trace',
        updatedAt: 222,
      },
    ];

    const finalized = finalizeStreamingMessages(
      messages,
      { statusMessageId: 'status', contentMessageId: 'content' },
      {
        finalResponse: 'done',
        sources: [] as string[],
        toolEvents: [] as string[],
        elapsedSeconds: 5,
        agentStatuses: [] as string[],
      }
    );

    expect(finalized).toEqual([
      expect.objectContaining({ id: 'status', trace_id: 'status-trace', updatedAt: 111 }),
      expect.objectContaining({ id: 'content', trace_id: 'content-trace', updatedAt: 222 }),
    ]);
  });

  it('finalizes whichever streaming placeholder is present', () => {
    const statusOnly: TestMessage[] = [
      {
        id: 'status',
        role: 'assistant',
        content: '',
        isStreaming: true,
        isAgentStatus: true,
      },
    ];
    const contentOnly: TestMessage[] = [
      {
        id: 'content',
        role: 'assistant',
        content: 'partial',
        isStreaming: true,
        isAgentStatus: false,
      },
    ];

    const payload = {
      finalResponse: 'done',
      sources: ['source'],
      toolEvents: ['tool'],
      elapsedSeconds: 4,
      agentStatuses: ['complete'],
      updatedAt: 456,
    };

    expect(
      finalizeStreamingMessages(
        statusOnly,
        { statusMessageId: 'status', contentMessageId: 'content' },
        payload
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
        updatedAt: 456,
      },
    ]);

    expect(
      finalizeStreamingMessages(
        contentOnly,
        { statusMessageId: 'status', contentMessageId: 'content' },
        payload
      )
    ).toEqual([
      {
        id: 'content',
        role: 'assistant',
        content: 'done',
        isStreaming: false,
        isAgentStatus: false,
        elapsedSeconds: 4,
        sources: ['source'],
        toolEvents: [],
        updatedAt: 456,
      },
    ]);
  });

  it('returns the original messages when finalization ids are not present', () => {
    const messages: TestMessage[] = [
      {
        id: 'unrelated',
        role: 'assistant',
        content: 'keep',
        isStreaming: true,
      },
    ];

    const finalized = finalizeStreamingMessages(
      messages,
      { statusMessageId: 'status', contentMessageId: 'content' },
      {
        finalResponse: 'done',
        sources: [] as string[],
        toolEvents: [] as string[],
        elapsedSeconds: 0,
        agentStatuses: [] as string[],
      }
    );

    expect(finalized).toBe(messages);
  });

  it('applies streaming error to the latest matching content message', () => {
    const messages: TestMessage[] = [
      {
        id: 'content',
        role: 'assistant',
        content: 'older',
        isStreaming: false,
        sources: ['old-source'],
      },
      { id: 'content', role: 'assistant', content: 'old', isStreaming: true, sources: ['source'] },
    ];

    expect(
      applyStreamingErrorMessage(messages, 'content', 'failed', { clearSources: true })
    ).toEqual([
      {
        id: 'content',
        role: 'assistant',
        content: 'older',
        isStreaming: false,
        sources: ['old-source'],
      },
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

  it('skips trailing unrelated messages when applying a streaming error', () => {
    const messages: TestMessage[] = [
      { id: 'content', role: 'assistant', content: 'old', isStreaming: true },
      { id: 'status', role: 'assistant', content: '', isStreaming: true, isAgentStatus: true },
    ];

    expect(applyStreamingErrorMessage(messages, 'content', 'failed')).toEqual([
      {
        id: 'content',
        role: 'assistant',
        content: 'failed',
        isStreaming: false,
        error: 'failed',
      },
      { id: 'status', role: 'assistant', content: '', isStreaming: true, isAgentStatus: true },
    ]);
  });

  it('preserves sources by default when applying a streaming error', () => {
    const messages: TestMessage[] = [
      { id: 'content', role: 'assistant', content: 'old', isStreaming: true, sources: ['source'] },
    ];

    expect(applyStreamingErrorMessage(messages, 'content', 'failed')).toEqual([
      {
        id: 'content',
        role: 'assistant',
        content: 'failed',
        isStreaming: false,
        error: 'failed',
        sources: ['source'],
      },
    ]);
  });

  it('returns the original messages when applying an error to an unknown id', () => {
    const messages: TestMessage[] = [
      { id: 'content', role: 'assistant', content: 'old', isStreaming: true, sources: ['source'] },
    ];

    expect(applyStreamingErrorMessage(messages, 'missing', 'failed')).toBe(messages);
  });
});
