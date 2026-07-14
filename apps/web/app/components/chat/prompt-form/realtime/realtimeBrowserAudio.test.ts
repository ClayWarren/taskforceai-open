import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../../tests/setup/dom';

import { base64ToUint8Array } from '@taskforceai/client-runtime';

import { RealtimeBrowserMicrophone } from './realtimeBrowserAudio';
import {
  installRealtimeBrowserTestEnvironment,
  MockAudioContext,
  MockAudioWorkletNode,
} from './useRealtimeVoiceSession.test-fixtures';

describe('RealtimeBrowserMicrophone', () => {
  let restoreBrowserEnvironment: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreBrowserEnvironment = installRealtimeBrowserTestEnvironment();
  });

  afterEach(() => {
    restoreBrowserEnvironment();
  });

  it('captures microphone audio with an AudioWorkletNode and cleans up resources', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    const onAudio = vi.fn();
    const microphone = new RealtimeBrowserMicrophone();

    await microphone.start(stream, onAudio);

    const context = MockAudioContext.instances[0];
    const node = MockAudioWorkletNode.instances[0];
    expect(context?.audioWorklet?.addModule).toHaveBeenCalledWith('blob:realtime-worklet');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:realtime-worklet');
    expect(node?.name).toBe('taskforceai-realtime-microphone');
    expect(node?.options).toEqual({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    expect(node?.port.start).toHaveBeenCalled();

    node?.port.dispatchSamples(new Float32Array([0, 0.5, -0.5]));

    const audio = onAudio.mock.calls[0]?.[0];
    expect(typeof audio).toBe('string');
    expect(base64ToUint8Array(audio).byteLength).toBe(6);

    microphone.stop();

    expect(node?.port.close).toHaveBeenCalled();
    expect(node?.disconnect).toHaveBeenCalled();
    expect(context?.close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the microphone stream if AudioWorklet is unavailable', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: vi.fn(() => [track]),
    } as unknown as MediaStream;
    class MockAudioContextWithoutWorklet extends MockAudioContext {
      override audioWorklet = undefined;
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContextWithoutWorklet,
    });
    const microphone = new RealtimeBrowserMicrophone();

    await expect(microphone.start(stream, vi.fn())).rejects.toThrow(
      'Realtime voice requires AudioWorklet support.'
    );

    expect(track.stop).toHaveBeenCalled();
  });
});
