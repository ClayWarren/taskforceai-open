import { beforeEach, describe, expect, it, vi } from 'bun:test';

type MockSpan = {
  end: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
};

const span: MockSpan = {
  end: vi.fn(),
  recordException: vi.fn(),
  setAttribute: vi.fn(),
  setStatus: vi.fn(),
};

const startActiveSpan = vi.fn(async (_name: string, operation: (span: MockSpan) => unknown) => {
  return await operation(span);
});

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { ERROR: 2 },
  trace: {
    getTracer: vi.fn(() => ({ startActiveSpan })),
  },
}));

const { traceOperation } = await import('./trace-operation');

describe('persistence/trace-operation', () => {
  beforeEach(() => {
    span.end.mockClear();
    span.recordException.mockClear();
    span.setAttribute.mockClear();
    span.setStatus.mockClear();
    startActiveSpan.mockClear();
  });

  it('returns the operation result and ends the span', async () => {
    const result = await traceOperation('test.success', async (activeSpan) => {
      activeSpan.setAttribute('test.attr', 'value');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(startActiveSpan).toHaveBeenCalledWith('test.success', expect.any(Function));
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setStatus).not.toHaveBeenCalledWith({ code: 2 });
  });

  it('records failed operations, ends the span, and rethrows', async () => {
    const error = new Error('trace failure');

    await expect(
      traceOperation('test.failure', async () => {
        throw error;
      })
    ).rejects.toThrow('trace failure');

    expect(span.recordException).toHaveBeenCalledWith(error);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
