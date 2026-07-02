/**
 * DOM test setup - happy-dom + testing-library for React/frontend tests
 * Extends base setup with DOM globals
 */
/* c8 ignore file */
/* istanbul ignore file */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'bun:test';
import 'fake-indexeddb/auto';

import '../frontend-global-mocks';
import './base';
import {
  createCookieProxy,
  mockAnchorClicks,
  mockRadixDismissableLayer,
  mockWindowLocation,
  patchFetch,
  patchScreenBindings,
  polyfillAnimationFrame,
  polyfillLegacyElementEvents,
  setGlobal,
  setupDomGlobals,
  setupMatchers,
} from './shared';

// Explicitly ensure fake-indexeddb is on all possible globals
if (typeof globalThis !== 'undefined') {
  const {
    indexedDB,
    IDBKeyRange,
    IDBIndex,
    IDBObjectStore,
    IDBDatabase,
    IDBTransaction,
    IDBCursor,
    IDBRequest,
  } = require('fake-indexeddb');

  (globalThis as any).indexedDB = indexedDB;
  (globalThis as any).IDBKeyRange = IDBKeyRange;
  (globalThis as any).IDBIndex = IDBIndex;
  (globalThis as any).IDBObjectStore = IDBObjectStore;
  (globalThis as any).IDBDatabase = IDBDatabase;
  (globalThis as any).IDBTransaction = IDBTransaction;
  (globalThis as any).IDBCursor = IDBCursor;
  (globalThis as any).IDBRequest = IDBRequest;
}

try {
  GlobalRegistrator.register({
    url: 'http://localhost/',
  });
} catch {
  // Some app-level test scripts preload a DOM already; keep this setup idempotent.
}

// React 19 requires this flag for act() warnings
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Fetch patching
patchFetch();

// Radix UI mock
mockRadixDismissableLayer();

// Use happy-dom globals; no JSDOM fallback
const domWindow = window as unknown as Window;
const domDocument = document;
const { proxy: documentProxy } = createCookieProxy(domDocument);

// Copy DOM globals
setupDomGlobals(domWindow, documentProxy);

try {
  const styleEl = domDocument.createElement('style');
  styleEl.textContent = 'html, body { pointer-events: auto !important; }';
  domDocument.head?.appendChild(styleEl);
} catch {
  /* ignore */
}

// React legacy polyfills
polyfillLegacyElementEvents();

// Animation frame polyfills
polyfillAnimationFrame();

// Patch testing-library screen bindings
patchScreenBindings(domDocument);

// Extend expect with jest-dom matchers
setupMatchers();

// Mock window.location
mockWindowLocation();

// Mock anchor clicks
mockAnchorClicks();

// Reset DOM state between tests
beforeEach(() => {
  setGlobal('window', domWindow);
  setGlobal('document', documentProxy);
  setGlobal('navigator', domWindow.navigator);
  setGlobal('localStorage', domWindow.localStorage);
  if (typeof domWindow.localStorage !== 'undefined' && domWindow.localStorage.clear) {
    domWindow.localStorage.clear();
  }
  setGlobal('sessionStorage', domWindow.sessionStorage);
  if (typeof domWindow.sessionStorage !== 'undefined' && domWindow.sessionStorage.clear) {
    domWindow.sessionStorage.clear();
  }
  if (domDocument?.body) {
    domDocument.body.style.pointerEvents = 'auto';
  }
  patchScreenBindings(domDocument);
  cleanup();
});

afterEach(() => {
  setGlobal('window', domWindow);
  setGlobal('document', documentProxy);
  setGlobal('navigator', domWindow.navigator);
  setGlobal('localStorage', domWindow.localStorage);
  setGlobal('sessionStorage', domWindow.sessionStorage);
  if (domDocument?.body) {
    domDocument.body.style.pointerEvents = 'auto';
  }
  patchScreenBindings(domDocument);
  cleanup();
  vi.restoreAllMocks();
});
