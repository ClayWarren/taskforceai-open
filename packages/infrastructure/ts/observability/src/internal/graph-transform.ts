type GraphTransformOptions = {
  leaf: (value: unknown) => unknown;
  redact?: (key: string) => string | undefined;
  prepare?: (value: unknown) => unknown;
  memoize?: boolean;
  preserveArrayHoles?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const createGraphTransformer = ({
  leaf,
  redact,
  prepare,
  memoize = true,
  preserveArrayHoles = false,
}: GraphTransformOptions): ((value: unknown) => unknown) => {
  const active = new WeakSet<object>();
  const memo = new WeakMap<object, unknown>();

  const transform = (value: unknown): unknown => {
    if (prepare) {
      const prepared = prepare(value);
      if (!Object.is(prepared, value)) return transform(prepared);
    }
    if (!Array.isArray(value) && !isRecord(value)) return leaf(value);
    if (active.has(value)) return '[Circular]';
    if (memoize && memo.has(value)) return memo.get(value);

    const output: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
    if (Array.isArray(value) && preserveArrayHoles) (output as unknown[]).length = value.length;
    if (memoize) memo.set(value, output);
    active.add(value);

    if (Array.isArray(value)) {
      if (preserveArrayHoles) {
        for (let index = 0; index < value.length; index += 1) {
          if (index in value) (output as unknown[])[index] = transform(value[index]);
        }
      } else {
        for (const entry of value) (output as unknown[]).push(transform(entry));
      }
    } else {
      for (const [key, entry] of Object.entries(value)) {
        const redacted = redact?.(key);
        (output as Record<string, unknown>)[key] = redacted ?? transform(entry);
      }
    }

    active.delete(value);
    return output;
  };

  return transform;
};
