import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';

import {
  clearAuthToken,
  clearStoredUser,
  getStoredToken,
  loadStoredUser,
  storeAuthToken,
  storeUser,
} from './auth-storage';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;
const baseUser: AuthenticatedUser = {
  id: 1,
  email: 'test@example.com',
  full_name: 'Test User',
  plan: 'free',
  message_count: 0,
  free_tasks_remaining: 0,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  subscription_source: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'system',
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  mfa_enabled: false,
  notifications_enabled: true,
  trust_layer_enabled: true,
  quick_mode_enabled: true,
  customer_id: null,
  disabled: 'false',
  is_admin: 'false',
  trial_ends_at: null,
};

const expectError = <T>(
  result: { ok: true; value: T } | { ok: false; error: string },
  error: string
) => {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(error);
  }
};

const expectValue = <T>(result: { ok: true; value: T } | { ok: false }, value: T) => {
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toBe(value);
  }
};

const setWindowHostname = (hostname: string) => {
  Object.defineProperty(globalThis.window, 'location', {
    value: { hostname },
    configurable: true,
  });
};

describe('shared/auth/auth-storage', () => {
  let mockLocalStorage: Record<string, string>;
  let mockStorage: Storage;

  beforeEach(() => {
    mockLocalStorage = {};
    mockStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]);
      }),
      length: 0,
      key: vi.fn(() => null),
    };

    const location = { hostname: 'localhost' } as unknown as Location;
    globalThis.window = {
      localStorage: mockStorage,
      location,
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    });

    clearAuthToken();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();

    if (typeof originalWindow === 'undefined') {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      globalThis.window = originalWindow;
    }

    if (typeof originalDocument === 'undefined') {
      delete (globalThis as { document?: Document }).document;
    } else {
      globalThis.document = originalDocument;
    }

    if (typeof originalLocalStorage === 'undefined') {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  it('migrates legacy authToken into memory and clears persisted key', () => {
    mockLocalStorage['authToken'] = 'legacy-token-123';

    const token = getStoredToken();

    expectValue(token, 'legacy-token-123');
    expect(mockLocalStorage['authToken']).toBeUndefined();
  });

  it('returns NOT_FOUND when legacy token is empty', () => {
    mockLocalStorage['authToken'] = '';

    const token = getStoredToken();

    expectError(token, 'NOT_FOUND');
  });

  it('returns NOT_FOUND and clears legacy token when token is whitespace only', () => {
    mockLocalStorage['authToken'] = '   ';

    const token = getStoredToken();

    expectError(token, 'NOT_FOUND');
    expect(mockLocalStorage['authToken']).toBeUndefined();
  });

  it('returns PARSE_ERROR when stored user JSON is malformed', () => {
    mockLocalStorage['authUser'] = '{bad json';

    const result = loadStoredUser();

    expectError(result, 'PARSE_ERROR');
  });

  it('returns NO_WINDOW when loading stored user on the server', () => {
    delete (globalThis as { window?: Window & typeof globalThis }).window;

    const result = loadStoredUser();

    expectError(result, 'NO_WINDOW');
  });

  it('returns NOT_FOUND when no stored user exists', () => {
    const result = loadStoredUser();

    expectError(result, 'NOT_FOUND');
  });

  it('returns PARSE_ERROR when stored user payload has wrong JSON shape', () => {
    mockLocalStorage['authUser'] = JSON.stringify('string-instead-of-object');

    const result = loadStoredUser();

    expectError(result, 'PARSE_ERROR');
  });

  it('loads valid stored user data', () => {
    mockLocalStorage['authUser'] = JSON.stringify({
      id: 1,
      email: 'test@example.com',
      tier: 'PRO',
      createdAt: '2026-01-01T00:00:00Z',
      extra: 'preserved',
    });

    const result = loadStoredUser();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.email).toBe('test@example.com');
      expect(result.value['extra' as keyof typeof result.value]).toBe('preserved');
    }
  });

  it('stores user data and writes an auth cookie', () => {
    const result = storeUser(baseUser);

    expect(result.ok).toBe(true);
    expect(JSON.parse(mockLocalStorage['authUser'] ?? '{}')).toMatchObject({
      email: 'test@example.com',
    });
  });

  it('returns storage errors when user persistence fails', () => {
    mockStorage.setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });

    const result = storeUser(baseUser);

    expect(result.ok).toBe(false);
  });

  it('continues storing user data when auth cookie writing fails', () => {
    globalThis.document = Object.preventExtensions({}) as Document;

    const result = storeUser(baseUser);

    expect(result.ok).toBe(true);
    expect(JSON.parse(mockLocalStorage['authUser'] ?? '{}')).toMatchObject({
      email: 'test@example.com',
    });
  });

  it('adds taskforce cookie domain only for exact host or subdomain', () => {
    const cookieWrites: string[] = [];
    globalThis.document = {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    } as Document;

    setWindowHostname('console.taskforceai.chat');
    storeUser(baseUser);

    setWindowHostname('evil-taskforceai.chat');
    storeUser(baseUser);

    expect(cookieWrites[0]).toContain('Domain=.taskforceai.chat');
    expect(cookieWrites[1]).not.toContain('Domain=.taskforceai.chat');
  });

  it('omits secure cookie attribute only for local development hosts', () => {
    const cookieWrites: string[] = [];
    globalThis.document = {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    } as Document;

    setWindowHostname('localhost');
    storeUser(baseUser);

    setWindowHostname('notlocalhost.example');
    storeUser(baseUser);

    expect(cookieWrites[0]).not.toContain('; Secure');
    expect(cookieWrites[1]).toContain('; Secure');
  });

  it('clears stored user and legacy token state', () => {
    mockLocalStorage['authUser'] = JSON.stringify({ email: 'test@example.com' });
    mockLocalStorage['authToken'] = 'legacy-token';
    storeAuthToken('memory-token');

    clearStoredUser();
    const token = getStoredToken();

    expect(mockLocalStorage['authUser']).toBeUndefined();
    expect(mockLocalStorage['authToken']).toBeUndefined();
    expectError(token, 'NOT_FOUND');
  });

  it('prefers in-memory token and clears persisted legacy token when storing', () => {
    mockLocalStorage['authToken'] = 'stale-token';

    storeAuthToken('memory-token');
    const token = getStoredToken();

    expectValue(token, 'memory-token');
    expect(mockLocalStorage['authToken']).toBeUndefined();
  });

  it('returns NO_WINDOW when running server-side without in-memory token', () => {
    clearAuthToken();
    delete (globalThis as { window?: Window & typeof globalThis }).window;
    delete (globalThis as { localStorage?: Storage }).localStorage;

    const token = getStoredToken();

    expectError(token, 'NO_WINDOW');
  });
});
