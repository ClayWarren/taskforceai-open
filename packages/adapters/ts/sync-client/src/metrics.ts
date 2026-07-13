export interface SyncMetricsCollector {
  incrementCounter(name: string, tags?: Record<string, unknown>): void;
  startTimer(name: string, tags?: Record<string, unknown>): () => void;
}

export const noopSyncMetrics: SyncMetricsCollector = {
  incrementCounter: () => {},
  startTimer: () => () => {},
};
