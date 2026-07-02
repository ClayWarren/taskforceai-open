export declare class AsyncLocalStorage<T> {
  private store?: T;
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
  exit<R>(callback: () => R): R;
}

declare const asyncHooksShim: {
  AsyncLocalStorage: typeof AsyncLocalStorage;
};

export default asyncHooksShim;
