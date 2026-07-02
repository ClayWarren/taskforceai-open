import { loadAvailableMcpTools } from '../src/mcpInventory';
import { patchManagedStreamingStatusMessage } from '../src/useManagedStreamingMessages';

type BenchmarkCase = {
  name: string;
  operationsPerIteration: number;
  iterations: number;
  run: () => void | Promise<void>;
};

type BenchmarkResult = {
  name: string;
  iterations: number;
  operations: number;
  medianMs: number;
  averageMs: number;
  nsPerOperation: number;
};

type BenchmarkMessage = {
  id: string;
  content: string;
  isAgentStatus?: boolean;
  toolEvents?: string[];
  agentStatuses?: string[];
  elapsedSeconds?: number;
  pendingApproval?: string;
};

type BenchmarkMcpServer = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

type BenchmarkMcpTool = {
  name: string;
  title: string;
  description: string;
};

const SAMPLE_COUNT = 7;
const MESSAGE_COUNT = 5_000;
const MCP_SERVER_COUNT = 40;
const MCP_TOOLS_PER_SERVER = 100;

let checksum = 0;

const makeMessages = (count: number): BenchmarkMessage[] => {
  const messages: BenchmarkMessage[] = [];
  for (let index = 0; index < count - 2; index += 1) {
    messages.push({
      id: `message-${index}`,
      content: `Message ${index}`,
    });
  }
  messages.push({
    id: 'status-live',
    content: '',
    isAgentStatus: true,
    toolEvents: [],
    agentStatuses: [],
  });
  messages.push({
    id: 'content-live',
    content: 'streaming',
  });
  return messages;
};

const baselineToolPatch = (
  previous: BenchmarkMessage[],
  toolEvents: string[]
): BenchmarkMessage[] =>
  previous.map((message) => (message.id === 'status-live' ? { ...message, toolEvents } : message));

const baselineAgentPatch = (
  previous: BenchmarkMessage[],
  toolEvents: string[],
  agentStatuses: string[],
  elapsedSeconds: number,
  pendingApproval: string | null
): BenchmarkMessage[] =>
  previous.map((message) =>
    message.id === 'status-live' && message.isAgentStatus
      ? {
          ...message,
          elapsedSeconds,
          toolEvents,
          agentStatuses,
          pendingApproval: pendingApproval ?? undefined,
        }
      : message
  );

const runBaselineStatusPatch = (): void => {
  let messages = makeMessages(MESSAGE_COUNT);
  for (let index = 0; index < 1_000; index += 1) {
    const toolEvents = [`tool-${index % 8}`];
    messages = baselineToolPatch(messages, toolEvents);
    messages = baselineAgentPatch(messages, toolEvents, [`agent-${index % 4}`], index % 60, null);
  }
  checksum += messages[messages.length - 2]?.agentStatuses?.length ?? 0;
};

const runOptimizedStatusPatch = (): void => {
  let messages = makeMessages(MESSAGE_COUNT);
  for (let index = 0; index < 1_000; index += 1) {
    const toolEvents = [`tool-${index % 8}`];
    messages = patchManagedStreamingStatusMessage<BenchmarkMessage, string, string>(
      messages,
      'status-live',
      {
        toolEvents,
      }
    );
    messages = patchManagedStreamingStatusMessage<BenchmarkMessage, string, string>(
      messages,
      'status-live',
      {
        elapsedSeconds: index % 60,
        toolEvents,
        agentStatuses: [`agent-${index % 4}`],
        pendingApproval: null,
        requireAgentStatus: true,
      }
    );
  }
  checksum += messages[messages.length - 2]?.agentStatuses?.length ?? 0;
};

const mcpServers: BenchmarkMcpServer[] = Array.from(
  { length: MCP_SERVER_COUNT },
  (_unused, index) => ({
    name: `server-${String(MCP_SERVER_COUNT - index).padStart(2, '0')}`,
    endpoint: `endpoint-${index}`,
    enabled: true,
  })
);

const inspectMcpServer = async (
  server: BenchmarkMcpServer
): Promise<{ tools: BenchmarkMcpTool[] }> => ({
  tools: Array.from({ length: MCP_TOOLS_PER_SERVER }, (_unused, index) => ({
    name: `tool-${String(MCP_TOOLS_PER_SERVER - index).padStart(3, '0')}`,
    title: `Tool ${index}`,
    description: `Tool ${index} on ${server.name}`,
  })),
});

const compareMcpInventoryItems = (
  left: { serverName: string; toolName: string },
  right: { serverName: string; toolName: string }
) => left.serverName.localeCompare(right.serverName) || left.toolName.localeCompare(right.toolName);

const runBaselineMcpInventory = async (): Promise<void> => {
  const items: { serverName: string; toolName: string; title: string; description: string }[] = [];
  const snapshots = await Promise.all(mcpServers.map((server) => inspectMcpServer(server)));
  for (let serverIndex = 0; serverIndex < snapshots.length; serverIndex += 1) {
    const serverName = mcpServers[serverIndex]?.name ?? '';
    for (const tool of snapshots[serverIndex]?.tools ?? []) {
      const item = {
        serverName,
        toolName: tool.name,
        title: tool.title.trim(),
        description: tool.description.trim(),
      };
      const insertAt = items.findIndex((current) => compareMcpInventoryItems(item, current) < 0);
      if (insertAt === -1) {
        items.push(item);
      } else {
        items.splice(insertAt, 0, item);
      }
    }
  }
  checksum += items.length + (items[0]?.toolName.length ?? 0);
};

const runOptimizedMcpInventory = async (): Promise<void> => {
  const summary = await loadAvailableMcpTools(() => mcpServers, inspectMcpServer);
  checksum += summary.toolCount + (summary.items[0]?.toolName.length ?? 0);
};

const cases: BenchmarkCase[] = [
  {
    name: 'managed-status-patch-baseline',
    operationsPerIteration: 2_000,
    iterations: 20,
    run: runBaselineStatusPatch,
  },
  {
    name: 'managed-status-patch-optimized',
    operationsPerIteration: 2_000,
    iterations: 20,
    run: runOptimizedStatusPatch,
  },
  {
    name: 'mcp-inventory-sort-baseline',
    operationsPerIteration: MCP_SERVER_COUNT * MCP_TOOLS_PER_SERVER,
    iterations: 100,
    run: runBaselineMcpInventory,
  },
  {
    name: 'mcp-inventory-sort-optimized',
    operationsPerIteration: MCP_SERVER_COUNT * MCP_TOOLS_PER_SERVER,
    iterations: 100,
    run: runOptimizedMcpInventory,
  },
];

const median = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const runBenchmark = async (benchmark: BenchmarkCase): Promise<BenchmarkResult> => {
  /* eslint-disable no-await-in-loop -- Benchmarks intentionally measure sequential operations. */
  for (let index = 0; index < 3; index += 1) {
    await benchmark.run();
  }

  const sampleMs: number[] = [];
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    const start = performance.now();
    for (let index = 0; index < benchmark.iterations; index += 1) {
      await benchmark.run();
    }
    sampleMs.push(performance.now() - start);
  }
  /* eslint-enable no-await-in-loop */

  const operations = benchmark.iterations * benchmark.operationsPerIteration;
  const medianMs = median(sampleMs);
  const averageMs = sampleMs.reduce((sum, value) => sum + value, 0) / sampleMs.length;

  return {
    name: benchmark.name,
    iterations: benchmark.iterations,
    operations,
    medianMs,
    averageMs,
    nsPerOperation: (medianMs * 1_000_000) / operations,
  };
};

const selectedCase = Bun.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
const selectedBenchmarks = selectedCase
  ? cases.filter((benchmark) => benchmark.name === selectedCase)
  : cases;

if (selectedBenchmarks.length === 0) {
  throw new Error(`Unknown benchmark case: ${selectedCase}`);
}

console.log('react-core performance benchmark');
console.log(`messages=${MESSAGE_COUNT}`);
console.log(`samples=${SAMPLE_COUNT}`);

/* eslint-disable no-await-in-loop -- Benchmark cases are reported sequentially for stable output. */
for (const benchmark of selectedBenchmarks) {
  const result = await runBenchmark(benchmark);
  console.log(
    [
      result.name,
      `iterations=${result.iterations}`,
      `operations=${result.operations}`,
      `median=${result.medianMs.toFixed(3)}ms`,
      `average=${result.averageMs.toFixed(3)}ms`,
      `ns/op=${result.nsPerOperation.toFixed(1)}`,
    ].join(' ')
  );
}
/* eslint-enable no-await-in-loop */

console.log(`checksum=${checksum}`);
