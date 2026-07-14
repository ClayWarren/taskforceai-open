export const deepClone = <T>(value: T): T => {
  const clone = globalThis.structuredClone;
  if (typeof clone === 'function') {
    return clone(value);
  }
  return cloneFallback(value, new WeakMap<object, unknown>()) as T;
};

const cloneFallback = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached) return cached;
    const result: unknown[] = [];
    seen.set(value, result);
    for (const entry of value) result.push(cloneFallback(entry, seen));
    return result;
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    const cached = seen.get(value);
    if (cached) return cached;
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(record));
    seen.set(value, result);
    for (const [key, entry] of Object.entries(record)) {
      result[key] = cloneFallback(entry, seen);
    }
    return result;
  }
  return value;
};
