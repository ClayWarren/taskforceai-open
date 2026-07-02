type LatencyMarkGlobal = typeof globalThis & {
  __TASKFORCEAI_LATENCY_MARK__?: unknown;
};

type LatencyMarker = (name: string, detail?: unknown) => void;

export const reportOptionalLatencyMark = (name: string, detail?: unknown): void => {
  const mark = (globalThis as LatencyMarkGlobal).__TASKFORCEAI_LATENCY_MARK__;
  if (typeof mark !== 'function') {
    return;
  }

  try {
    (mark as LatencyMarker)(name, detail);
  } catch {
    // Benchmark instrumentation must never affect production behavior.
  }
};
