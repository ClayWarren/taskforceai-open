import {
  runThroughputBenchmarkSuite,
  type ThroughputBenchmarkCase,
} from '../../../../../scripts/perf/operation-benchmark';
import { VoiceManager } from './VoiceManager';
import type { VoiceAdapter } from './types';

const readyAdapter: VoiceAdapter = {
  async init(): Promise<void> {},
  async speak(_text: string): Promise<void> {},
  async listen(): Promise<string> {
    return 'benchmark transcript';
  },
  async record(): Promise<{ data: string; format: string }> {
    return { data: 'benchmark-audio', format: 'wav' };
  },
  async cancel(): Promise<void> {},
};

const manager = new VoiceManager(readyAdapter);
await manager.init();

const iterations = Number(process.env['VOICE_MANAGER_BENCH_ITERATIONS'] ?? '200000');

const cases: ThroughputBenchmarkCase[] = [
  {
    name: 'ready speak success path',
    run: async () => {
      await manager.speak('hello from benchmark');
    },
  },
  {
    name: 'ready listen success path',
    run: async () => {
      await manager.listen();
    },
  },
  {
    name: 'ready record success path',
    run: async () => {
      await manager.record();
    },
  },
];

await runThroughputBenchmarkSuite('voice/VoiceManager', cases, { iterations });
