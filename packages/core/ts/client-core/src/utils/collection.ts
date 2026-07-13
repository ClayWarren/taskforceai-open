export const groupBy = <T>(
  array: T[],
  key: keyof T | ((item: T) => PropertyKey)
): Partial<Record<string, T[]>> => {
  const selector =
    typeof key === 'function'
      ? (item: T) => String(key(item))
      : (item: T) => {
          const value = item[key];
          return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol'
            ? String(value)
            : JSON.stringify(value ?? '');
        };

  if (typeof Object.groupBy === 'function') {
    return Object.groupBy(array, selector);
  }

  return array.reduce<Record<string, T[]>>(
    (acc, item) => {
      const group = selector(item);
      (acc[group] ||= []).push(item);
      return acc;
    },
    Object.create(null) as Record<string, T[]>
  );
};

export const unique = <T>(array: T[]): T[] => {
  return Array.from(new Set(array));
};

export const sortedCopy = <T>(
  values: readonly T[],
  compareFn?: (left: T, right: T) => number
): T[] => {
  // oxlint-disable-next-line unicorn/no-array-sort -- Runtime fallback for clients without Array.prototype.toSorted.
  return Array.from(values).sort(compareFn);
};

export const chunk = <T>(array: T[], size: number): T[][] => {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('Chunk size must be a positive integer');
  }

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const isEmpty = (obj: object): boolean => {
  return Object.keys(obj).length === 0;
};

export const pick = <T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
  return keys.reduce(
    (acc, key) => {
      if (key in obj) acc[key] = obj[key];
      return acc;
    },
    {} as Pick<T, K>
  );
};

export const omit = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  const omitSet = new Set<keyof T>(keys);
  const partial: Partial<T> = {};
  for (const key of Object.keys(obj)) {
    const typedKey = key as keyof T;
    if (!omitSet.has(typedKey)) {
      partial[typedKey] = obj[typedKey];
    }
  }
  return partial as Omit<T, K>;
};

export const flatMap = <T, U>(values: T[], fn: (value: T, index: number) => U[]): U[] =>
  values.flatMap(fn);

export const countBy = <T, K extends string>(values: T[], fn: (value: T) => K): Record<K, number> =>
  values.reduce(
    (acc, value) => {
      const key = fn(value);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<K, number>
  );
