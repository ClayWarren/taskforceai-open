import {
  arrayBufferToBase64,
  base64ToUint8Array,
  REALTIME_INPUT_SAMPLE_RATE,
  REALTIME_OUTPUT_SAMPLE_RATE,
} from '@taskforceai/client-runtime';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type AudioContextConstructor = typeof AudioContext;

const getAudioContextConstructor = (): AudioContextConstructor => {
  const ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!ctor) {
    throw new Error('Realtime voice requires Web Audio support.');
  }
  return ctor;
};

const resampleAudio = (
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array => {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * ratio;
    const floorIndex = Math.floor(sourceIndex);
    const ceilIndex = Math.min(floorIndex + 1, input.length - 1);
    const fraction = sourceIndex - floorIndex;
    const floorSample = input[floorIndex] ?? 0;
    const ceilSample = input[ceilIndex] ?? floorSample;
    output[index] = floorSample * (1 - fraction) + ceilSample * fraction;
  }
  return output;
};

const floatSamplesToPcm16Base64 = (samples: Float32Array): string => {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return arrayBufferToBase64(buffer);
};

const pcm16Base64ToFloatSamples = (base64Audio: string): Float32Array => {
  const bytes = base64ToUint8Array(base64Audio);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
};

const MICROPHONE_WORKLET_PROCESSOR_NAME = 'taskforceai-realtime-microphone';
const MICROPHONE_WORKLET_SOURCE = `
class TaskForceAIRealtimeMicrophoneProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) {
      output.fill(0);
    }
    if (input && input.length > 0) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('${MICROPHONE_WORKLET_PROCESSOR_NAME}', TaskForceAIRealtimeMicrophoneProcessor);
`;

const loadMicrophoneWorklet = async (context: AudioContext): Promise<void> => {
  const workletUrl = URL.createObjectURL(
    new Blob([MICROPHONE_WORKLET_SOURCE], { type: 'application/javascript' })
  );
  try {
    await context.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
};

export class RealtimeBrowserMicrophone {
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;

  async start(stream: MediaStream, onAudio: (base64Audio: string) => void): Promise<void> {
    this.stop();
    const AudioContextCtor = getAudioContextConstructor();
    const context = new AudioContextCtor({ sampleRate: REALTIME_INPUT_SAMPLE_RATE });
    this.context = context;
    this.stream = stream;

    try {
      if (!context.audioWorklet) {
        throw new Error('Realtime voice requires AudioWorklet support.');
      }

      await loadMicrophoneWorklet(context);
      const source = context.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(context, MICROPHONE_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      processor.port.addEventListener('message', (event: MessageEvent<Float32Array>) => {
        const input = event.data;
        const samples = resampleAudio(
          new Float32Array(input),
          context.sampleRate,
          REALTIME_INPUT_SAMPLE_RATE
        );
        onAudio(floatSamplesToPcm16Base64(samples));
      });
      processor.port.start();

      source.connect(processor);
      processor.connect(context.destination);
      this.processor = processor;
      this.source = source;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.processor?.port.close();
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.context?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
  }
}

export class RealtimeBrowserPcmPlayer {
  private context: AudioContext | null = null;
  private playbackTime = 0;
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  constructor(private readonly onPlayingChange: (isPlaying: boolean) => void) {}

  enqueue(base64Audio: string): void {
    const samples = pcm16Base64ToFloatSamples(base64Audio);
    if (samples.length === 0) {
      return;
    }

    const context = this.ensureContext();
    const buffer = context.createBuffer(1, samples.length, REALTIME_OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startTime = Math.max(this.playbackTime, context.currentTime);
    source.start(startTime);
    this.playbackTime = startTime + buffer.duration;
    this.activeSources.add(source);
    this.onPlayingChange(true);

    source.addEventListener(
      'ended',
      () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          this.playbackTime = context.currentTime;
          this.onPlayingChange(false);
        }
      },
      { once: true }
    );
  }

  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped by the browser.
      }
    }
    this.activeSources.clear();
    if (this.context) {
      this.playbackTime = this.context.currentTime;
    }
    this.onPlayingChange(false);
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      const AudioContextCtor = getAudioContextConstructor();
      this.context = new AudioContextCtor({ sampleRate: REALTIME_OUTPUT_SAMPLE_RATE });
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
    return this.context;
  }
}
