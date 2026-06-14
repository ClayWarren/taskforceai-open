import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = '@taskforceai/persistence';

export const traceOperation = async <T>(
  spanName: string,
  operation: (span: Span) => Promise<T>
): Promise<T> => {
  const tracer = trace.getTracer(TRACER_NAME);

  return await tracer.startActiveSpan(spanName, async (span) => {
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
