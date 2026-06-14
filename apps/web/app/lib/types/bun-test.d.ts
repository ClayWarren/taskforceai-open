import { type TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'bun:test' {
  interface Matchers<T = any> extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
}
