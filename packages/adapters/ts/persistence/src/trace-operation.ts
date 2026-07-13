export interface TraceSpanPort {
  setAttribute(name: string, value: string | number | boolean): void;
}

export type TraceOperationPort = <T>(
  spanName: string,
  operation: (span: TraceSpanPort) => Promise<T>
) => Promise<T>;

const noopSpan: TraceSpanPort = {
  setAttribute: () => {},
};

const noopTraceOperation: TraceOperationPort = async (_spanName, operation) =>
  await operation(noopSpan);

let traceOperationImplementation: TraceOperationPort = noopTraceOperation;

export const configurePersistenceTracing = (
  implementation: TraceOperationPort = noopTraceOperation
): void => {
  traceOperationImplementation = implementation;
};

export const traceOperation: TraceOperationPort = async (spanName, operation) =>
  await traceOperationImplementation(spanName, operation);
