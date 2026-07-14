import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

export type TraceSpan = Pick<Span, 'setAttribute'>;
export type TraceOperation = <T>(
  spanName: string,
  operation: (span: TraceSpan) => Promise<T>
) => Promise<T>;

export const createTraceOperation = (tracerName: string): TraceOperation => {
  const tracer = trace.getTracer(tracerName);

  return async (spanName, operation) =>
    await tracer.startActiveSpan(spanName, async (span) => {
      try {
        return await operation(span);
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
};
