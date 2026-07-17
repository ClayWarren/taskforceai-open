export type LatencyReporter = (name: string, detail?: unknown) => void;

let latencyReporter: LatencyReporter | undefined;

export const configureLatencyReporter = (reporter: LatencyReporter): void => {
  latencyReporter = reporter;
};

export const reportLatencyMark = (name: string, detail?: unknown): void => {
  try {
    latencyReporter?.(name, detail);
  } catch {
    // Optional telemetry must never affect adapter behavior.
  }
};
