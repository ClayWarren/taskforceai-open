/**
 * Mock for expo-modules-core/src/polyfill/dangerous-internal used in test setup
 */
export const polyfillGlobal = () => {};
export const polyfillInternal = () => {};
export const installExpoGlobalPolyfill = () => {
  const globalScope = globalThis as typeof globalThis & {
    expo?: {
      modules?: Record<string, unknown>;
      SharedObject?: new (...args: unknown[]) => object;
    };
  };

  globalScope.expo ??= {};
  globalScope.expo.modules ??= {};
  globalScope.expo.SharedObject ??= class SharedObject {
    readonly __mockSharedObject = true;
  };
};
