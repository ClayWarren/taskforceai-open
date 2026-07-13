import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { StreamingProvider } from '../../lib/providers/StreamingProvider';
import {
  MessageBubble,
  MockAudio,
  elementScrollToMock,
  installMessageBubbleHarness,
  loggerErrorMock,
  mockVoiceManager,
  renderMessage,
  renderScrollableMessage,
  requestUrl,
  scrollIntoViewMock,
  tauriInvokeMock,
  usePlatformRuntimeMock,
} from './MessageBubble.test-harness';

describe('MessageBubble autoscroll and voice', () => {
  installMessageBubbleHarness();
  it('auto-scrolls when user is near the bottom', () => {
    const { rerender } = renderScrollableMessage(340);

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 244,
      behavior: 'auto',
    });

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 340, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'Updated response', id: 'scroll-message' } as any}
          isUser={false}
        />
      </div>
    );

    expect(elementScrollToMock).toHaveBeenCalledTimes(2);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 244,
      behavior: 'auto',
    });
  });

  it('keeps streaming assistant messages tail-aligned while content arrives', () => {
    render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 340, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={
            { content: 'Streaming response', id: 'streaming-message', isStreaming: true } as any
          }
          isUser={false}
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      block: 'end',
    });
  });

  it('keeps latest realtime voice user transcripts tail-aligned while content arrives', () => {
    const { rerender } = render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1800 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'This is live', id: 'realtime-voice-user-1' } as any}
          isLatestMessage
          isUser
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'end',
    });

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1900 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={
            { content: 'This is live and still growing', id: 'realtime-voice-user-1' } as any
          }
          isLatestMessage
          isUser
        />
      </div>
    );

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'end',
    });
  });

  it('does not auto-scroll when user is reading older messages', () => {
    const { rerender } = renderScrollableMessage(200, 1800);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 1800 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <MessageBubble
          message={{ content: 'Updated response', id: 'scroll-message' } as any}
          isUser={false}
        />
      </div>
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('anchors the latest completed assistant reply even after a large content jump', () => {
    renderScrollableMessage(200, 4000, { isLatestMessage: true });

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 104,
      behavior: 'auto',
    });
  });

  it('anchors a latest assistant reply when a streaming message completes', () => {
    const message = {
      content: 'Streaming response',
      id: 'streaming-to-complete-message',
      isStreaming: true,
    };
    const { rerender } = render(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 4000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <StreamingProvider>
          <MessageBubble message={message as any} isUser={false} isLatestMessage />
        </StreamingProvider>
      </div>
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(elementScrollToMock).not.toHaveBeenCalled();

    rerender(
      <div
        ref={(node) => {
          if (!node) {
            return;
          }
          Object.defineProperties(node, {
            scrollHeight: { configurable: true, value: 4000 },
            clientHeight: { configurable: true, value: 600 },
            scrollTop: { configurable: true, value: 200, writable: true },
          });
        }}
        style={{ overflowY: 'auto' }}
      >
        <StreamingProvider>
          <MessageBubble
            message={{ ...message, isStreaming: false } as any}
            isUser={false}
            isLatestMessage
          />
        </StreamingProvider>
      </div>
    );

    expect(elementScrollToMock).toHaveBeenCalledTimes(1);
    expect(elementScrollToMock).toHaveBeenLastCalledWith({
      top: 104,
      behavior: 'auto',
    });
  });

  it('renders multiline user messages and copies them', async () => {
    renderMessage({ content: 'Line one\nLine two', id: '13' }, { isUser: true });

    fireEvent.click(screen.getByTitle('Copy message'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Line one\nLine two');
      expect(screen.getByText('Copied')).toBeTruthy();
    });
  });

  it('copies bot responses and invokes share callbacks', async () => {
    const onShare = vi.fn();
    renderMessage({ content: 'Shareable response', id: '14' }, { canShare: true, onShare });

    fireEvent.click(screen.getByTitle('Copy response'));
    fireEvent.click(screen.getByTitle('Share conversation'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Shareable response');
      expect(screen.getByText('Copied')).toBeTruthy();
    });
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('does not render empty assistant messages', () => {
    const { container } = render(
      <MessageBubble message={{ content: '   ', id: '15' } as any} isUser={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('does not speak blank assistant content', () => {
    renderMessage({
      content: '   ',
      id: '16',
      toolEvents: [
        {
          toolName: 'create_chart',
          generatedFile: {
            filename: 'chart.png',
            mimeType: 'image/png',
            downloadUrl: '/api/file',
          },
        },
      ],
    });

    fireEvent.click(screen.getByTitle('Listen to response'));

    expect(screen.getByTitle('Listen to response')).toHaveAttribute('disabled');
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/speech/generate', expect.anything());
  });

  it('uses app-server speech generation in desktop runtime without exposing bearer auth', async () => {
    usePlatformRuntimeMock.mockReturnValue('desktop');
    renderMessage({ content: 'Hello desktop', id: '16b' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_speech_generate', {
        params: { text: 'Hello desktop' },
      });
      expect(MockAudio.instances[0]?.play).toHaveBeenCalled();
    });
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      'https://www.taskforceai.chat/api/speech/generate',
      expect.anything()
    );
    expect(mockVoiceManager.speak).not.toHaveBeenCalled();
  });

  it('stops active speech when the listen button is clicked during playback', async () => {
    renderMessage({ content: 'Long response', id: '17' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:speech-audio');
    });
  });

  it('logs and resets state when speech fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith('/api/speech/generate')) {
        return Response.json({ error: 'Speech generation failed' }, { status: 502 });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    renderMessage({ content: 'Speak me', id: '18' });

    fireEvent.click(screen.getByText('Listen'));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to speak message',
        expect.objectContaining({ error: expect.any(Error) })
      );
      expect(screen.getByText('Listen')).toBeTruthy();
    });
  });

  it('logs when stopping speech fails', async () => {
    renderMessage({ content: 'Stop me', id: '19' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());
    MockAudio.instances[0]?.pause.mockImplementationOnce(() => {
      throw new Error('stop failed');
    });

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Failed to stop generated speech playback',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  it('logs when copying a message fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard denied');
        }),
      },
    });

    renderMessage({ content: 'Copy fail', id: '20' }, { isUser: true });
    fireEvent.click(screen.getByTitle('Copy message'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy fail');
      expect(screen.queryByText('Copied')).toBeNull();
    });
  });

  it('ignores opening sources when no sources are available', () => {
    renderMessage({ content: 'No sources', id: '21' });
    expect(screen.queryByTestId('sources')).toBeNull();
    expect(screen.queryByTestId('sources-sidebar')).toBeNull();
  });

  it('cleans up voice playback on unmount', async () => {
    mockVoiceManager.cancel.mockResolvedValueOnce(undefined);
    const { unmount } = renderMessage({ content: 'Unmount me', id: '22' });

    fireEvent.click(screen.getByText('Listen'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeTruthy());

    unmount();

    await waitFor(() => {
      expect(MockAudio.instances[0]?.pause).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:speech-audio');
      expect(mockVoiceManager.cancel).toHaveBeenCalled();
    });
  });
});
