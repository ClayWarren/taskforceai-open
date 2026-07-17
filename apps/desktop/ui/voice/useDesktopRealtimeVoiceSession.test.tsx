import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const fetchRealtimeVoiceSetup = mock(async () => {
  throw new Error('setup unavailable');
});

class SocketController {
  current = null;
  closeCurrent = mock();
  clear = mock();
  isCurrent = mock(() => false);
  bind = mock();
}

class TranscriptController {
  reset() {
    return [];
  }
}

class AudioSender {
  send = mock();
}

mock.module('@taskforceai/client-runtime', () => ({
  applyRealtimeVoiceTranscriptEvent: mock(() => null),
  buildRealtimeVoiceSessionConfig: mock(() => ({})),
  fetchRealtimeVoiceSetup,
  RealtimeVoiceAudioSender: AudioSender,
  RealtimeVoiceSocketController: SocketController,
  RealtimeVoiceTranscriptController: TranscriptController,
}));

mock.module('@taskforceai/web/app/lib/api/realtime-voice-socket', () => ({
  openRealtimeVoiceSocket: mock(),
}));

mock.module('@taskforceai/web/app/lib/logger', () => ({
  logger: { error: mock(), warn: mock() },
}));

mock.module('../platform/voice-gateway', () => ({
  createVoiceGatewayRequestOptions: mock(async () => ({})),
}));

const microphoneStop = mock();
const playerStop = mock();

mock.module(
  '@taskforceai/web/app/components/chat/prompt-form/realtime/realtimeBrowserAudio',
  () => ({
    RealtimeBrowserMicrophone: class {
      stop = microphoneStop;
      start = mock();
    },
    RealtimeBrowserPcmPlayer: class {
      stop = playerStop;
      enqueue = mock();
      dispose = mock();
    },
  })
);

import { useDesktopRealtimeVoiceSession } from './useDesktopRealtimeVoiceSession';

describe('useDesktopRealtimeVoiceSession', () => {
  beforeEach(() => {
    fetchRealtimeVoiceSetup.mockClear();
    microphoneStop.mockClear();
    playerStop.mockClear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: mock(async () => ({
          getTracks: () => [{ stop: mock() }],
        })),
      },
    });
  });

  it('keeps setup failures in the error state after cleaning up resources', async () => {
    const setErrorMessage = mock();
    const { result } = renderHook(() => useDesktopRealtimeVoiceSession({ setErrorMessage }));

    await act(async () => {
      await result.current.connect();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(setErrorMessage).toHaveBeenCalledWith('setup unavailable');
    expect(microphoneStop).toHaveBeenCalled();
    expect(playerStop).toHaveBeenCalled();
  });
});
