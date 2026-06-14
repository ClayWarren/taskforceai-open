import { jest } from '@jest/globals';

export const requireNativeModule = jest.fn(() => ({}));
export const requireOptionalNativeModule = jest.fn(() => ({}));
export const requireNativeViewManager = jest.fn(() => ({}));

export const __esModule = true;
export default {
  requireNativeModule,
  requireOptionalNativeModule,
  requireNativeViewManager,
};
