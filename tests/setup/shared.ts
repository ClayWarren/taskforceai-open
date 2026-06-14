/**
 * Shared test setup utilities - used by both bun-setup.ts and setup/dom.ts
 * Provides DOM globals, fetch patching, Radix UI mocking, testing-library matchers,
 * cookie proxy, and other common test infrastructure.
 */
/* c8 ignore file */
/* istanbul ignore file */
import {
  getQueriesForElement,
  queries,
  screen as testingLibraryScreen,
} from '@testing-library/dom';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'bun:test';
import { ReadableStream, WritableStream } from 'node:stream/web';

export const setGlobal = (key: string, value: unknown) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  if (!descriptor || !descriptor.writable || !descriptor.configurable) {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
    return;
  }
  (globalThis as Record<string, unknown>)[key] = value;
};

/**
 * Create a document proxy that intercepts cookie access for testability.
 */
export function createCookieProxy(domDocument: Document): {
  proxy: Document;
  resetCookie: () => void;
} {
  let cookieJar = '';
  const proxy = new Proxy(domDocument, {
    get(target, prop: keyof Document) {
      if ((prop as string) === '__isProxy') {
        return true;
      }
      if (prop === 'cookie') {
        return cookieJar;
      }
      const value = Reflect.get(target, prop);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
    set(target, prop: keyof Document, value) {
      if (prop === 'cookie') {
        cookieJar = String(value ?? '');
        return true;
      }
      return Reflect.set(target, prop, value as never);
    },
  });
  return {
    proxy,
    resetCookie: () => {
      cookieJar = '';
    },
  };
}

/**
 * Copy DOM globals from a Window object to globalThis.
 */
export function setupDomGlobals(domWindow: Window, documentProxy: Document) {
  setGlobal('window', domWindow);
  setGlobal('document', documentProxy);
  setGlobal('navigator', domWindow.navigator);
  const domWindowGlobals = domWindow as unknown as {
    Node?: typeof Node;
    Event?: typeof Event;
    EventTarget?: typeof EventTarget;
    CustomEvent?: typeof CustomEvent;
    HTMLElement?: typeof HTMLElement;
    HTMLFormElement?: typeof HTMLFormElement;
    HTMLAnchorElement?: typeof HTMLAnchorElement;
    Element?: typeof Element;
    MutationObserver?: typeof MutationObserver;
    Blob?: typeof Blob;
    File?: typeof File;
    FormData?: typeof FormData;
  };
  setGlobal('Node', domWindowGlobals.Node ?? Node);
  setGlobal('ReadableStream', ReadableStream);
  setGlobal('WritableStream', WritableStream);
  setGlobal('Event', domWindowGlobals.Event ?? Event);
  setGlobal('EventTarget', domWindowGlobals.EventTarget ?? EventTarget);
  setGlobal('CustomEvent', domWindowGlobals.CustomEvent ?? CustomEvent);
  setGlobal('HTMLElement', domWindowGlobals.HTMLElement ?? HTMLElement);
  setGlobal('HTMLFormElement', domWindowGlobals.HTMLFormElement ?? HTMLFormElement);
  setGlobal('HTMLAnchorElement', domWindowGlobals.HTMLAnchorElement ?? HTMLAnchorElement);
  setGlobal('Element', domWindowGlobals.Element ?? Element);
  setGlobal('getComputedStyle', domWindow.getComputedStyle.bind(domWindow));
  setGlobal('MutationObserver', domWindowGlobals.MutationObserver ?? MutationObserver);
  setGlobal('Blob', domWindowGlobals.Blob ?? Blob);
  setGlobal('File', domWindowGlobals.File ?? File);
  setGlobal('FormData', domWindowGlobals.FormData ?? FormData);
  setGlobal('localStorage', domWindow.localStorage);
  setGlobal('sessionStorage', domWindow.sessionStorage);
  setGlobal('location', domWindow.location ?? new URL('http://localhost/'));
}

/**
 * Polyfill Element.prototype.attachEvent/detachEvent for React legacy input polyfills.
 */
export function polyfillLegacyElementEvents() {
  if (typeof Element !== 'undefined') {
    type ElementWithLegacyEvents = Element & {
      attachEvent?: () => void;
      detachEvent?: () => void;
    };
    const proto = Element.prototype as ElementWithLegacyEvents;
    if (typeof proto.attachEvent !== 'function') {
      proto.attachEvent = () => {};
    }
    if (typeof proto.detachEvent !== 'function') {
      proto.detachEvent = () => {};
    }
  }
}

/**
 * Polyfill requestAnimationFrame / cancelAnimationFrame.
 */
export function polyfillAnimationFrame() {
  setGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
  );
  setGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}

/**
 * Patch testing-library screen bindings to the current document body.
 */
export function patchScreenBindings(domDocument: Document) {
  try {
    const body = domDocument?.body;
    if (!body) return;
    const boundQueries = getQueriesForElement(body, queries);
    Object.assign(testingLibraryScreen as unknown as Record<string, unknown>, boundQueries);
    (globalThis as Record<string, unknown>)['screen'] = testingLibraryScreen;
  } catch {
    /* noop */
  }
}

/**
 * Extend expect with jest-dom matchers.
 */
export function setupMatchers() {
  expect.extend(matchers);
}

/**
 * Mock @radix-ui/react-dismissable-layer to a simple passthrough for happy-dom.
 */
export function mockRadixDismissableLayer() {
  void vi.mock('@radix-ui/react-dismissable-layer', () => {
    const React = require('react');
    const Passthrough = React.forwardRef(function PassthroughRef(
      props: Record<string, unknown>,
      ref: React.Ref<HTMLElement>
    ) {
      const {
        asChild,
        disableOutsidePointerEvents,
        onEscapeKeyDown,
        onPointerDownOutside,
        onFocusOutside,
        onInteractOutside,
        onDismiss,
        ...rest
      } = props ?? {};

      if (asChild && React.isValidElement(rest['children'])) {
        return React.cloneElement(rest['children'] as React.ReactElement, { ref });
      }

      void disableOutsidePointerEvents;
      void onEscapeKeyDown;
      void onPointerDownOutside;
      void onFocusOutside;
      void onInteractOutside;
      void onDismiss;

      return React.createElement('div', { ...rest, ref });
    });

    return { Root: Passthrough, DismissableLayer: Passthrough };
  });
}

/**
 * Normalize URLSearchParams bodies for fetch in test environment,
 * intercept auth log requests, and optionally inject chaos harness.
 */
export function patchFetch(opts?: { chaosFailureRate?: number; chaosMaxLatencyMs?: number }) {
  const globalObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : undefined;

  if (!globalObj || typeof globalObj.fetch === 'undefined') {
    return;
  }

  const chaosRate = opts?.chaosFailureRate ?? 0;
  const chaosLatency = opts?.chaosMaxLatencyMs ?? 0;

  const originalFetch = globalObj.fetch;
  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let requestInput = input;
    let requestInit = init;
    let requestUrl: URL | null = null;

    if (typeof requestInput === 'string' && requestInput.startsWith('/')) {
      requestUrl = new URL(requestInput, 'http://localhost');
      requestInput = requestUrl.toString();
    } else if (requestInput instanceof URL) {
      requestUrl = requestInput;
    } else if (requestInput instanceof Request) {
      requestUrl = new URL(
        requestInput.url,
        requestInput.url.startsWith('http') ? undefined : 'http://localhost'
      );
    } else if (typeof requestInput === 'string') {
      try {
        requestUrl = new URL(requestInput);
      } catch {
        requestUrl = new URL(requestInput, 'http://localhost');
        requestInput = requestUrl.toString();
      }
    }

    if (
      requestUrl &&
      requestUrl.hostname === 'localhost' &&
      requestUrl.pathname === '/api/auth/_log'
    ) {
      return new Response(null, { status: 204 });
    }

    if (init?.body instanceof URLSearchParams) {
      const headers = new Headers(init.headers ?? {});
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/x-www-form-urlencoded');
      }
      requestInit = {
        ...init,
        body: init.body.toString(),
        headers,
      };
    }

    if (chaosRate > 0 && Math.random() < chaosRate) {
      throw new Error('Chaos harness: simulated fetch failure');
    }

    if (chaosLatency > 0) {
      const latency = Math.random() * chaosLatency;
      await new Promise((resolve) => setTimeout(resolve, latency));
    }

    return originalFetch(requestInput, requestInit as RequestInit);
  }) as typeof fetch;

  globalObj.fetch = wrappedFetch;
  if (typeof window !== 'undefined') {
    (window as any).fetch = wrappedFetch;
  }
}

/**
 * Mock window.location to prevent actual navigation in tests.
 */
export function mockWindowLocation() {
  const mockLocation = {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => '',
  };

  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
    if (descriptor && !descriptor.configurable) {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'location');
    }
    Object.defineProperty(window, 'location', {
      value: mockLocation,
      writable: true,
      configurable: true,
    });
  } catch {
    setGlobal('location', mockLocation);
  }
}

/**
 * Mock anchor element clicks to prevent actual navigation.
 */
export function mockAnchorClicks() {
  if (typeof window !== 'undefined' && typeof window.HTMLAnchorElement !== 'undefined') {
    const anchorPrototype = window.HTMLAnchorElement.prototype;
    if (anchorPrototype && typeof anchorPrototype.click === 'function') {
      anchorPrototype.click = vi.fn();
    }
  }
}

/**
 * Set up beforeEach/afterEach hooks for DOM state reset between tests.
 */
export function setupDomResetHooks(
  domWindow: Window,
  domDocument: Document,
  documentProxy: Document
) {
  beforeEach(() => {
    setGlobal('window', domWindow);
    setGlobal('document', documentProxy);
    setGlobal('navigator', domWindow.navigator);
    setGlobal('localStorage', domWindow.localStorage);
    setGlobal('sessionStorage', domWindow.sessionStorage);
    patchScreenBindings(domDocument);
    cleanup();
  });

  afterEach(() => {
    setGlobal('window', domWindow);
    setGlobal('document', documentProxy);
    setGlobal('navigator', domWindow.navigator);
    setGlobal('localStorage', domWindow.localStorage);
    setGlobal('sessionStorage', domWindow.sessionStorage);
    patchScreenBindings(domDocument);
    cleanup();
  });
}
