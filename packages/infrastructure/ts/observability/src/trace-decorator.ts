import { trace, SpanStatusCode } from '@opentelemetry/api';

type TraceDecorator = <This, Args extends unknown[], Return>(
  originalMethod: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
) => (this: This, ...args: Args) => Return;

/**
 * A modern ES decorator that automatically wraps a class method in an OpenTelemetry span.
 * It handles starting the span, recording any exceptions, setting the error status,
 * and ensuring the span is properly closed in a finally block.
 *
 * @param spanName Optional custom name for the span. Defaults to "ClassName.methodName".
 * @param tracerName Optional custom name for the tracer. Defaults to "@taskforceai/decorator".
 */
export function Trace(
  spanName?: string,
  tracerName: string = '@taskforceai/decorator'
): TraceDecorator {
  return function <This, Args extends unknown[], Return>(
    originalMethod: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
  ): (this: This, ...args: Args) => Return {
    return function (this: This, ...args: Args): Return {
      // If no span name is provided, default to ClassName.methodName
      const defaultName = `${this?.constructor?.name ?? 'UnknownClass'}.${String(context.name)}`;
      const name = spanName ?? defaultName;

      const tracer = trace.getTracer(tracerName);

      return tracer.startActiveSpan(name, (span): Return => {
        try {
          const result = originalMethod.apply(this, args);
          if (isPromiseLike(result)) {
            return Promise.resolve(result)
              .catch((error: unknown) => {
                // Automatically record errors
                span.recordException(error as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw error;
              })
              .finally(() => {
                // Guarantee the span is closed
                span.end();
              }) as Return;
          }
          // Guarantee the span is closed for sync methods without changing return semantics.
          span.end();
          return result;
        } catch (error) {
          // Automatically record errors
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          // Guarantee the span is closed
          span.end();
          throw error;
        }
      });
    };
  };
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }
  if (value === null) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === 'function';
};
