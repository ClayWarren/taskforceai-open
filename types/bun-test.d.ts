import { type expect } from 'bun:test';
import { type TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'bun:test' {
  interface Matchers<T = unknown> extends TestingLibraryMatchers<
    ReturnType<typeof expect.stringContaining>,
    T
  > {}
}

declare global {
  var __DEV__: boolean;
  var registerTestMock: (specifier: string, factoryOrValue: unknown) => void;
  var resetTestMocks: () => void;
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
