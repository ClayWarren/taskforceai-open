/**
 * Mock implementation of expo-modules-core for Jest tests
 * This provides the necessary exports without loading native modules
 */

// CodedError class
export class CodedError extends Error {
  code: string;
  info?: unknown;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

// UnavailabilityError class
export class UnavailabilityError extends CodedError {
  constructor(moduleName: string, propertyName: string) {
    super(
      'ERR_UNAVAILABLE',
      `The method or property ${moduleName}.${propertyName} is not available in test environment`
    );
    this.name = 'UnavailabilityError';
  }
}

// Mock EventSubscription
export interface Subscription {
  remove: () => void;
}

export type EventSubscription = Subscription;

// Mock EventEmitter
export class EventEmitter {
  private listeners: Map<string, Set<Function>> = new Map();

  addListener(eventName: string, listener: Function): EventSubscription {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listener);
    return { remove: () => this.removeListener(eventName, listener) };
  }

  removeListener(eventName: string, listener: Function): void {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit(eventName: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => listener(...args));
    }
  }
}

export class LegacyEventEmitter extends EventEmitter {}

// Mock Platform
export const Platform = {
  OS: 'ios',
  select: (obj: Record<string, unknown>) => obj['ios'] ?? obj['default'],
};

// Mock uuid
export const uuid = {
  v4: () => 'test-uuid-' + Math.random().toString(36).substring(2, 9),
};

// Mock NativeModule - Base class for native modules
export class NativeModule {
  [key: string]: unknown;
}

// Mock SharedObject
export class SharedObject {
  readonly __mockId = 'shared-object';
}

// Mock SharedRef
export class SharedRef {
  readonly __mockId = 'shared-ref';
}

// Mock requireNativeViewManager
export const requireNativeViewManager = (_viewName: string) => {
  throw new UnavailabilityError('expo-modules-core', 'requireNativeViewManager');
};

// Mock requireNativeModule
export const requireNativeModule = (_moduleName: string) => {
  throw new UnavailabilityError('expo-modules-core', 'requireNativeModule');
};

export const requireOptionalNativeModule = (_moduleName: string) => null;

export const requireOptionalNativeViewManager = (_viewName: string) => null;

export const reloadAppAsync = async () => {};

export const registerWebModule = () => {};

export const registerWebModuleAsync = async () => {};

export const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

// Export all
export default {
  CodedError,
  UnavailabilityError,
  EventEmitter,
  LegacyEventEmitter,
  Platform,
  uuid,
  NativeModule,
  SharedObject,
  SharedRef,
  requireNativeViewManager,
  requireNativeModule,
  requireOptionalNativeModule,
  requireOptionalNativeViewManager,
  reloadAppAsync,
  registerWebModule,
  registerWebModuleAsync,
  PermissionStatus,
};
