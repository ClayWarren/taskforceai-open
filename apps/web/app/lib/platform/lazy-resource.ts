export interface LazyResourceLoader<T> {
  get: () => Promise<T>;
  getResolved: () => T | null;
}

export const createLazyResourceLoader = <T>(load: () => Promise<T>): LazyResourceLoader<T> => {
  let resolved: T | null = null;
  let hasResolved = false;
  let pending: Promise<T> | null = null;

  const get = async () => {
    if (hasResolved) {
      return resolved as T;
    }

    if (!pending) {
      pending = load()
        .then((value) => {
          resolved = value;
          hasResolved = true;
          return value;
        })
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
    }

    return pending;
  };

  return {
    get,
    getResolved: () => resolved,
  };
};

export const createLazyAsyncProxy = <T extends object>(load: () => Promise<T>): T => {
  return new Proxy(
    {},
    {
      get(target, propertyKey, receiver) {
        if (propertyKey === 'then' || typeof propertyKey === 'symbol') {
          return undefined;
        }

        if (Reflect.has(target, propertyKey)) {
          return Reflect.get(target, propertyKey, receiver);
        }

        return async (...args: unknown[]) => {
          const resource = await load();
          const value = resource[propertyKey as keyof T];
          if (typeof value !== 'function') {
            return value;
          }
          return Reflect.apply(value as (...callArgs: unknown[]) => unknown, resource, args);
        };
      },
    }
  ) as T;
};
