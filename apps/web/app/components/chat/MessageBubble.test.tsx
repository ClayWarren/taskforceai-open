import { MAX_SPEECH_TEXT_CHARS } from '@taskforceai/client-runtime';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { StreamingProvider } from '../../lib/providers/StreamingProvider';
import {
  MessageBubble,
  MockAudio,
  MockAudioBufferSource,
  MockAudioContext,
  installMessageBubbleHarness,
  loggerErrorMock,
  renderMessage,
  requestUrl,
  withCsrfMock,
} from './MessageBubble.test-harness';

describe('MessageBubble', () => {
  installMessageBubbleHarness();
  it('renders user message', () => {
    renderMessage({ content: 'Hello', id: '1' }, { isUser: true });
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders bot message with markdown', () => {
    renderMessage({ id: '2' });
    expect(screen.getByTestId('markdown')).toBeTruthy();
    expect(screen.getByText('Response')).toBeTruthy();
  });

  it('renders AgentExecutionPanel for agent status messages', () => {
    renderMessage({
      content: 'Planning...',
      id: '3',
      isAgentStatus: true,
      agentStatuses: [{ status: 'PROCESSING', agent_id: 1 }],
    });
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders persisted execution metadata on final assistant messages', () => {
    renderMessage({
      content: 'Final answer',
      id: 'persisted-run',
      isAgentStatus: false,
      agentStatuses: [{ status: 'COMPLETED', agent_id: 1, model: 'GPT 5.6 Sol' }],
      toolEvents: [{ toolName: 'search_web', agentId: 1, status: 'completed' }],
    });

    expect(screen.getByRole('progressbar', { name: /overall agent progress/i })).toBeTruthy();
    expect(screen.getByTestId('markdown').textContent).toBe('Final answer');
  });

  it('renders Code execution as an inline timeline without the standard progress bubble', () => {
    renderMessage(
      {
        content: 'Final code update',
        id: 'persisted-code-run',
        isAgentStatus: false,
        elapsedSeconds: 18,
        toolEvents: [
          {
            agentId: 1,
            agentLabel: 'Code agent',
            toolName: 'exec_command',
            arguments: { command: 'bun test' },
            success: true,
            durationMs: 300,
            resultPreview: 'Tests passed',
          },
        ],
      },
      { executionPresentation: 'code' }
    );

    expect(screen.getByTestId('code-execution-timeline')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ran 1 command/i })).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: /overall agent progress/i })).toBeNull();
    expect(screen.getByTestId('markdown').textContent).toBe('Final code update');
    expect(screen.getByTestId('markdown').parentElement?.parentElement?.className).not.toContain(
      'border-l-2'
    );
  });

  it('renders generated file downloads below the assistant reply', () => {
    renderMessage({
      content: 'Created the chart.',
      id: 'generated-file-reply',
      isAgentStatus: false,
      agentStatuses: [{ status: 'COMPLETED', agent_id: 1, model: 'GPT 5.6 Sol' }],
      toolEvents: [
        {
          agentId: 0,
          agentLabel: 'Agent 1',
          toolName: 'create_chart',
          arguments: { filePath: 'sunlight-planets.png' },
          success: true,
          durationMs: 220,
          generatedFile: {
            filename: 'sunlight-planets.png',
            mimeType: 'image/png',
            bytes: 2048,
            fileId: 'file-generated',
            artifactId: 'artifact-generated',
            downloadUrl: '/api/v1/developer/files/file-generated/content',
          },
        },
      ],
    });

    const openLink = screen.getByRole('link', { name: 'Open sunlight-planets.png' });
    const downloadLink = screen.getByRole('link', { name: 'Download sunlight-planets.png' });

    expect(screen.getByTestId('markdown').textContent).toBe('Created the chart.');
    expect(screen.getByText('sunlight-planets.png')).toBeTruthy();
    expect(screen.getByText('image/png · 2.0 KB')).toBeTruthy();
    expect(openLink).toHaveAttribute('href', '/artifacts/artifact-generated');
    expect(downloadLink).toHaveAttribute('href', '/api/v1/developer/files/file-generated/content');
    expect(downloadLink).toHaveAttribute('download', 'sunlight-planets.png');
  });

  it('does not render generated file download anchors for unsafe URLs', () => {
    renderMessage({
      content: 'Created the chart.',
      id: 'unsafe-generated-file-reply',
      isAgentStatus: false,
      toolEvents: [
        {
          toolName: 'create_chart',
          generatedFile: {
            filename: 'unsafe.png',
            mimeType: 'image/png',
            downloadUrl: 'javascript:alert(1)',
          },
        },
      ],
    });

    expect(screen.getByText('unsafe.png')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download unsafe.png' })).toBeNull();
  });

  it('renders local command output without assistant message actions', () => {
    renderMessage({
      content: 'Status\napp-server: local',
      id: 'local-command',
      isLocalCommandOutput: true,
    });

    expect(screen.getByTestId('markdown').textContent).toBe('Status\napp-server: local');
    expect(screen.queryByTitle('Copy response')).toBeNull();
    expect(screen.queryByTitle('Listen to response')).toBeNull();
    expect(screen.queryByTitle('Helpful')).toBeNull();
    expect(screen.queryByTitle('Not helpful')).toBeNull();
  });

  it('hides listen, share, and feedback actions for private assistant messages', () => {
    renderMessage(
      {
        content: 'Private response',
        id: 'private-assistant',
      },
      {
        canShare: true,
        isPrivateChat: true,
        onShare: vi.fn(),
      }
    );

    expect(screen.getByTitle('Copy response')).toBeTruthy();
    expect(screen.queryByTitle('Listen to response')).toBeNull();
    expect(screen.queryByTitle('Share conversation')).toBeNull();
    expect(screen.queryByTitle('Helpful')).toBeNull();
    expect(screen.queryByTitle('Not helpful')).toBeNull();
  });

  it('handles voice speaking toggle', async () => {
    renderMessage({ content: 'Hello world', id: '4' });

    const listenBtn = screen.getByText('Listen');
    fireEvent.click(listenBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/speech/generate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Hello world' }),
        })
      );
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
    expect(MockAudio.instances[0]?.src).toBe('blob:speech-audio');
  });

  it('starts read aloud playback from the first chunk while prefetching the next chunk', async () => {
    const firstChunk = 'First chunk sentence. '.repeat(36).trim();
    const secondChunk = 'Second chunk sentence. '.repeat(60).trim();
    renderMessage({ content: `${firstChunk}\n\n${secondChunk}`, id: '4-chunked-speech' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const speechCalls = (
        globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.filter((call) => requestUrl(call[0]).endsWith('/api/speech/generate'));
      expect(speechCalls).toHaveLength(2);
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });

    const speechCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => requestUrl(call[0]).endsWith('/api/speech/generate')
    );
    const firstPayload = JSON.parse(String(speechCalls[0]?.[1]?.body)) as { text: string };
    const secondPayload = JSON.parse(String(speechCalls[1]?.[1]?.body)) as { text: string };
    expect(firstPayload.text).toBe(firstChunk);
    expect(secondPayload.text).toBe(secondChunk);
  });

  it('plays generated speech through an unlocked AudioContext when available', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });
    renderMessage({ content: 'Hello audio context', id: '4-audio-context' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const audioContext = MockAudioContext.instances[0];
      const source = MockAudioBufferSource.instances[0];

      expect(audioContext?.resume).toHaveBeenCalled();
      expect(audioContext?.decodeAudioData).toHaveBeenCalled();
      expect(source?.connect).toHaveBeenCalledWith(audioContext?.destination);
      expect(source?.start).toHaveBeenCalled();
    });
    expect(MockAudio.instances).toHaveLength(0);
  });

  it('keeps generated speech requests within the server text limit', async () => {
    const longContent = `${'word '.repeat(Math.ceil(MAX_SPEECH_TEXT_CHARS / 5) + 40)}done`;
    renderMessage({ content: longContent, id: '4-long-speech' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const speechCall = fetchMock.mock.calls.find((call) =>
        requestUrl(call[0]).endsWith('/api/speech/generate')
      );
      expect(speechCall).toBeDefined();
      const payload = JSON.parse(String(speechCall?.[1]?.body)) as { text: string };
      expect(payload.text.length).toBeLessThanOrEqual(MAX_SPEECH_TEXT_CHARS);
      expect(payload.text.startsWith('word ')).toBe(true);
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
  });

  it('renders sources button and opens modal', async () => {
    renderMessage({
      content: 'I found this',
      id: '5',
      sources: [{ url: 'http://test.com', title: 'Test' }],
    });

    const sourcesBtn = screen.getByText(/1 source/i);
    expect(sourcesBtn).toBeTruthy();

    fireEvent.click(sourcesBtn);
    expect(await screen.findByTestId('sources-sidebar')).toBeTruthy();
    expect(await screen.findByText('Count: 1')).toBeTruthy();
  });

  it('restores sources from persisted tool events when message sources are missing', async () => {
    renderMessage({
      content: 'I found this after refresh',
      id: '5a',
      toolEvents: [
        {
          agentId: 0,
          agentLabel: 'AGENT 1',
          toolName: 'search_web',
          arguments: { query: 'latest AI news' },
          success: true,
          durationMs: 250,
          sources: [{ url: 'https://news.example/story', title: 'News Story' }],
        },
      ],
    });

    const sourcesBtn = screen.getByText(/1 source/i);
    expect(sourcesBtn).toBeTruthy();

    fireEvent.click(sourcesBtn);
    expect(await screen.findByTestId('sources-sidebar')).toBeTruthy();
    expect(await screen.findByText('Count: 1')).toBeTruthy();
  });

  it('pluralizes source counts and opens sources with the latest message sources', async () => {
    const message = {
      content: 'I found more',
      id: '5b',
      sources: [
        { url: 'http://one.test', title: 'One' },
        { url: 'http://two.test', title: 'Two' },
      ],
    };
    const { rerender } = renderMessage(message);

    expect(screen.getByText(/2 sources/i)).toBeTruthy();

    rerender(
      <MessageBubble
        message={
          {
            ...message,
            sources: [
              { url: 'http://one.test', title: 'One' },
              { url: 'http://two.test', title: 'Two' },
              { url: 'http://three.test', title: 'Three' },
            ],
          } as any
        }
        isUser={false}
      />
    );

    fireEvent.click(screen.getByText(/3 sources/i));
    expect(await screen.findByText('Count: 3')).toBeTruthy();
  });

  it('renders user timestamp if provided', () => {
    const timestamp = new Date(2025, 0, 1, 12, 0).toISOString();
    renderMessage({ content: 'Hi', id: '6' }, { isUser: true, timestamp });
    expect(screen.getByText(/12:00/)).toBeTruthy();
  });

  it('renders realtime voice user messages as tight right-aligned bubbles with hover copy', () => {
    const timestamp = new Date(2025, 0, 1, 12, 0).toISOString();
    renderMessage(
      { content: 'Just to hear me.', id: 'realtime-voice-user-1' },
      { isUser: true, timestamp }
    );

    const content = screen.getByText('Just to hear me.');
    const messageBubble = content.closest('.message-bubble') as HTMLElement | null;
    const bubble = content.closest('.message-content')?.parentElement as HTMLElement | null;
    expect(bubble?.style.width).toBe('fit-content');
    expect(bubble?.style.maxWidth).toBe('min(32rem, 78%)');
    expect(messageBubble?.style.scrollMarginBlockEnd).toBe(
      'var(--realtime-voice-transcript-bottom-offset, 0px)'
    );
    expect(screen.queryByText(/12:00/)).toBeNull();

    const copyButton = screen.getByTitle('Copy message');
    expect(copyButton.textContent).toBe('');
    expect(copyButton.parentElement?.className).toContain('opacity-0');
  });

  it('renders assistant reply time in the action row', () => {
    const createdAt = new Date(2025, 0, 1, 12, 34).getTime();
    renderMessage({ content: 'Timed response', id: '6b', createdAt });

    expect(screen.getByText(/12:34/)).toBeTruthy();
  });

  it('renders realtime voice assistant actions as icon-only controls with time in overflow', () => {
    const createdAt = new Date(2025, 0, 1, 12, 34).getTime();
    renderMessage({
      content: "Got it-I'm here to listen. What's on your mind?",
      id: 'realtime-voice-assistant-1',
      createdAt,
    });

    const copyButton = screen.getByTitle('Copy response');
    expect(copyButton.textContent).toBe('');
    expect(screen.queryByTitle('Listen to response')).toBeNull();
    expect(screen.queryByText('Listen')).toBeNull();
    expect(screen.queryByText(/12:34/)).toBeNull();

    fireEvent.click(screen.getByTitle('More options'));

    expect(screen.getByText(/12:34/)).toBeTruthy();
  });

  it('omits assistant reply time for invalid timestamps', () => {
    renderMessage({ content: 'Untimed response', id: '6c', createdAt: Number.NaN });

    expect(screen.queryByText(/Invalid/)).toBeNull();
  });

  it('syncs feedback button state when message rating prop changes', () => {
    const message = { content: 'Rated', id: '7', rating: 0 };
    const { rerender } = renderMessage(message);
    const helpfulButton = screen.getByTitle('Helpful');
    expect(helpfulButton.className).not.toContain('text-emerald-500');

    rerender(
      <StreamingProvider>
        <MessageBubble message={{ ...message, rating: 1 } as any} isUser={false} />
      </StreamingProvider>
    );
    expect(screen.getByTitle('Helpful').className).toContain('text-emerald-500');
  });

  it('adds CSRF headers when submitting feedback', async () => {
    renderMessage({ content: 'Rated', id: '10', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(withCsrfMock).toHaveBeenCalledWith({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 1 }),
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/10/feedback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 1 }),
        })
      );
    });
  });

  it('toggles negative feedback and restores the previous rating when submit fails', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, statusText: 'Bad Request' }) as Response
    ) as unknown as typeof fetch;
    renderMessage({ content: 'Rated', id: '11', rating: 0 });

    fireEvent.click(screen.getByTitle('Not helpful'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/11/feedback',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: -1 }),
        })
      );
      expect(screen.getByTitle('Not helpful').className).not.toContain('text-rose-500');
    });
  });

  it('silently restores feedback state when the server cannot rate an unsynced message', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, status: 403, statusText: 'Forbidden' }) as Response
    ) as unknown as typeof fetch;
    renderMessage({ content: 'Rated', id: 'assistant-local', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(screen.getByTitle('Helpful').className).not.toContain('text-emerald-500');
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });
  });

  it('clears an existing positive rating when clicked again', async () => {
    renderMessage({ content: 'Rated', id: '12', rating: 1 });

    fireEvent.click(screen.getByLabelText('Rated positive'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/12/feedback',
        expect.objectContaining({
          body: JSON.stringify({ rating: 0 }),
        })
      );
    });
  });

  it('encodes message ids in feedback endpoint paths', async () => {
    renderMessage({ content: 'Rated', id: '../task-1', rating: 0 });

    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/v1/messages/..%2Ftask-1/feedback',
        expect.anything()
      );
    });
  });
});
