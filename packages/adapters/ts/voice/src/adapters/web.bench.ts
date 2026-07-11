import {
  runThroughputBenchmarkSuite,
  type ThroughputBenchmarkCase,
} from '../../../../../../scripts/perf/operation-benchmark';
import { WebVoiceAdapter } from './web';

type UtteranceListener = (event?: { error?: string }) => void;

class BenchmarkUtterance {
  readonly listeners: Record<string, UtteranceListener[]> = {};

  constructor(readonly text: string) {}

  addEventListener(event: string, listener: UtteranceListener): void {
    this.listeners[event] ??= [];
    this.listeners[event].push(listener);
  }
}

Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
  value: BenchmarkUtterance,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    speechSynthesis: {
      cancel: () => {},
      speak: (utterance: BenchmarkUtterance) => {
        utterance.listeners['end']?.forEach((listener) => listener());
      },
    },
  },
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaDevices: undefined,
  },
  writable: true,
  configurable: true,
});

const adapter = new WebVoiceAdapter();
await adapter.init();

const iterations = Number(process.env['WEB_VOICE_BENCH_ITERATIONS'] ?? '200000');

const cases: ThroughputBenchmarkCase[] = [
  {
    name: 'web speak success path',
    run: async () => {
      await adapter.speak('hello from benchmark');
    },
  },
];

await runThroughputBenchmarkSuite('voice/WebVoiceAdapter', cases, { iterations });
