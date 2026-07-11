import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import { base64ToUint8Array, REALTIME_INPUT_SAMPLE_RATE } from '@taskforceai/client-runtime';

import { RealtimeBrowserMicrophone } from './realtimeBrowserAudio';

class MockMediaStreamAudioSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioWorklet {
  addModule = vi.fn(async () => undefined);
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  audioWorklet: MockAudioWorklet | undefined = new MockAudioWorklet();
  currentTime = 0;
  destination = {};
  sampleRate = REALTIME_INPUT_SAMPLE_RATE;
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => new MockMediaStreamAudioSourceNode());

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? REALTIME_INPUT_SAMPLE_RATE;
    MockAudioContext.instances.push(this);
  }
}

class MockMessagePort {
  close = vi.fn();
  start = vi.fn();
  private listener: ((event: MessageEvent<Float32Array>) => void) | null = null;

  addEventListener = vi.fn(
    (eventName: string, listener: (event: MessageEvent<Float32Array>) => void) => {
      if (eventName === 'message') {
        this.listener = listener;
      }
    }
  );

  dispatchSamples(samples: Float32Array) {
    this.listener?.({ data: samples } as MessageEvent<Float32Array>);
  }
}

class MockAudioWorkletNode {
  static instances: MockAudioWorkletNode[] = [];

  connect = vi.fn();
  disconnect = vi.fn();
  port = new MockMessagePort();

  constructor(
    public readonly context: AudioContext,
    public readonly name: string,
    public readonly options: AudioWorkletNodeOptions
  ) {
    MockAudioWorkletNode.instances.push(this);
  }
}

describe('RealtimeBrowserMicrophone', () => {
  const originalAudioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  const originalAudioWorkletNodeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioWorkletNode'
  );
  const originalCreateObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  beforeEach(() => {
    vi.clearAllMocks();
    MockAudioContext.instances = [];
    MockAudioWorkletNode.instances = [];
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: MockAudioWorkletNode,
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:realtime-worklet'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (originalAudioContextDescriptor) {
      Object.defineProperty(window, 'AudioContext', originalAudioContextDescriptor);
    } else {
      Reflect.deleteProperty(window, 'AudioContext');
    }
    if (originalAudioWorkletNodeDescriptor) {
      Object.defineProperty(globalThis, 'AudioWorkletNode', originalAudioWorkletNodeDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
    }
    if (originalCreateObjectURLDescriptor) {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectURLDescriptor) {
      Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURLDescriptor);
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
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
