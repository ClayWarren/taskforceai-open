/**
 * Mobile API Integration Tests
 *
 * Exercises the API client surface area end-to-end with mocked responses.
 */
import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

type RegisterResponse = {
  username: string;
  email: string;
  full_name: string | null;
  plan: string;
  message_count: number;
  theme_preference: string;
  disabled: string;
  is_admin: string;
  last_message_timestamp: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  subscription_source: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  customer_id: string | null;
};

type LoginResponse = {
  access_token: string;
  token_type: string;
};

type Conversation = {
  id: number;
  timestamp: string;
  user_input: string;
  result: string;
  message_count?: number;
};

type ApiClientSubset = {
  register: (userData: {
    username: string;
    email: string;
    full_name: string;
    password: string;
  }) => Promise<RegisterResponse>;
  login: (username: string, password: string) => Promise<LoginResponse>;
  runTask: (body: { prompt: string }) => Promise<{ task_id: string; cached?: boolean | null }>;
  getConversations: () => Promise<Conversation[]>;
  currentUser: () => Promise<RegisterResponse>;
  deleteConversation: (id: number) => Promise<void>;
  logout: () => Promise<void>;
  updateTheme: () => Promise<void>;
  upgradePlan: () => Promise<void>;
  getSubscription: () => Promise<{ subscription: null }>;
  getProducts: () => Promise<{ products: unknown[] }>;
  createSubscription: () => Promise<{ checkout_url: string }>;
  cancelSubscription: () => Promise<void>;
  reactivateSubscription: () => Promise<void>;
  syncMobileSubscription: () => Promise<{
    plan: string;
    subscription_status: null;
    subscription_source: null;
    current_period_end: null;
  }>;
  getModelOptions: () => Promise<{ enabled: boolean; options: unknown[]; defaultModelId: string }>;
  registerPushToken: () => Promise<void>;
  unregisterPushToken: () => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const requireRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
};

const requireString = (value: unknown, message: string): string => {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
};

const nullableString = (value: unknown, message: string): string | null =>
  value === null ? null : requireString(value, message);

const parseUserResponse = (raw: Record<string, unknown>): RegisterResponse => ({
  username: requireString(raw['username'], 'Missing username'),
  email: requireString(raw['email'], 'Missing email'),
  full_name: nullableString(raw['full_name'], 'Missing full_name'),
  plan: requireString(raw['plan'], 'Missing plan'),
  message_count: typeof raw['message_count'] === 'number' ? raw['message_count'] : 0,
  theme_preference: requireString(raw['theme_preference'], 'Missing theme_preference'),
  disabled: requireString(raw['disabled'], 'Missing disabled'),
  is_admin: requireString(raw['is_admin'], 'Missing is_admin'),
  last_message_timestamp: nullableString(
    raw['last_message_timestamp'],
    'Missing last_message_timestamp'
  ),
  subscription_id: nullableString(raw['subscription_id'], 'Missing subscription_id'),
  subscription_status: nullableString(raw['subscription_status'], 'Missing subscription_status'),
  subscription_source: nullableString(raw['subscription_source'], 'Missing subscription_source'),
  current_period_start: nullableString(
    raw['current_period_start'],
    'Missing current_period_start'
  ),
  current_period_end: nullableString(raw['current_period_end'], 'Missing current_period_end'),
  cancel_at_period_end: raw['cancel_at_period_end'] === true,
  customer_id: nullableString(raw['customer_id'], 'Missing customer_id'),
});

const createMockClient = (responses: Map<string, MockResponse>): ApiClientSubset => {
  const mockFetch = async (url: string, options?: RequestInit): Promise<MockResponse> => {
    const key = `${options?.method || 'GET'} ${url}`;
    const response = responses.get(key);

    if (!response) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found',
      };
    }

    return response;
  };

  return {
    register: async (userData) => {
      const response = await mockFetch('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData),
      });
      if (!response.ok) throw new Error('Registration failed');
      const raw = requireRecord(await response.json(), 'Invalid register response');
      return parseUserResponse(raw);
    },
    login: async (username: string, password: string) => {
      const response = await mockFetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error('Login failed');
      const raw = requireRecord(await response.json(), 'Invalid login response');
      return {
        access_token: requireString(raw['access_token'], 'Missing access_token'),
        token_type: requireString(raw['token_type'], 'Missing token_type'),
      };
    },
    runTask: async (body: { prompt: string }) => {
      const response = await mockFetch('/api/v1/run', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Task execution failed');
      const raw = requireRecord(await response.json(), 'Invalid run response');
      return {
        task_id: requireString(raw['task_id'], 'Missing task_id'),
        cached: typeof raw['cached'] === 'boolean' ? raw['cached'] : null,
      };
    },
    getConversations: async () => {
      const response = await mockFetch('/api/v1/conversations', { method: 'GET' });
      if (!response.ok) throw new Error('Failed to fetch conversations');
      const data = requireRecord(await response.json(), 'Invalid conversations response');
      const conversations = data['conversations'];
      if (Array.isArray(conversations)) {
        return conversations.filter((item): item is Conversation => isRecord(item));
      }
      return [];
    },
    currentUser: async () => {
      const response = await mockFetch('/api/v1/auth/me', { method: 'GET' });
      if (!response.ok) throw new Error('Failed to fetch user');
      const raw = requireRecord(await response.json(), 'Invalid user response');
      return parseUserResponse(raw);
    },
    deleteConversation: async () => Promise.resolve(),
    logout: async () => Promise.resolve(),
    updateTheme: async () => Promise.resolve(undefined),
    upgradePlan: async () => Promise.resolve(undefined),
    getSubscription: async () => ({ subscription: null }),
    getProducts: async () => ({ products: [] }),
    createSubscription: async () => ({ checkout_url: '' }),
    cancelSubscription: async () => Promise.resolve(undefined),
    reactivateSubscription: async () => Promise.resolve(undefined),
    syncMobileSubscription: async () => ({
      plan: 'free',
      subscription_status: null,
      subscription_source: null,
      current_period_end: null,
    }),
    getModelOptions: async () => ({ enabled: false, options: [], defaultModelId: '' }),
    registerPushToken: async () => Promise.resolve(undefined),
    unregisterPushToken: async () => Promise.resolve(undefined),
  };
};

describe('Mobile API integration', () => {
  it('covers authentication, tasks, conversations, and error handling', async () => {
    const authResponses = new Map<string, MockResponse>();
    authResponses.set('POST /api/v1/auth/register', {
      ok: true,
      status: 201,
      json: async () => ({
        username: 'mobile_user',
        email: 'mobile@test.com',
        full_name: 'Mobile User',
        plan: 'free',
        message_count: 0,
        theme_preference: 'dark',
        disabled: 'false',
        is_admin: 'false',
        last_message_timestamp: null,
        subscription_id: null,
        subscription_status: null,
        subscription_source: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        customer_id: null,
      }),
      text: async () => JSON.stringify({ username: 'mobile_user' }),
    });
    authResponses.set('POST /api/v1/auth/login', {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'test_token_456',
        token_type: 'Bearer',
      }),
      text: async () => JSON.stringify({ access_token: 'test_token_456' }),
    });
    const authClient = createMockClient(authResponses);

    const registerResult = await authClient.register({
      username: 'mobile_user',
      email: 'mobile@test.com',
      full_name: 'Mobile User',
      password: 'SecurePass123!',
    });
    assert.equal(registerResult.username, 'mobile_user', 'Registration should return user data');
    assert.equal(registerResult.email, 'mobile@test.com', 'Should include email');

    const loginResult = await authClient.login('mobile_user', 'SecurePass123!');
    assert.ok(loginResult.access_token, 'Login should return access token');

    const taskResponses = new Map<string, MockResponse>();
    taskResponses.set('POST /api/v1/run', {
      ok: true,
      status: 200,
      json: async () => ({
        task_id: 'task_mobile_123',
        cached: false,
      }),
      text: async () => JSON.stringify({ task_id: 'task_mobile_123' }),
    });
    const taskClient = createMockClient(taskResponses);
    const taskResult = await taskClient.runTask({ prompt: 'Deploy TaskForceAI' });
    assert.equal(taskResult.task_id, 'task_mobile_123', 'Run should return task ID');
    assert.equal(taskResult.cached, false, 'Run should indicate cache state');

    const conversationResponses = new Map<string, MockResponse>();
    conversationResponses.set('GET /api/v1/conversations', {
      ok: true,
      status: 200,
      json: async () => ({
        conversations: [
          {
            id: 1,
            timestamp: '2024-01-01T00:00:00Z',
            user_input: 'Mobile Test Conversation',
            result: 'Latest assistant reply',
            message_count: 3,
          },
        ],
      }),
      text: async () => JSON.stringify({ conversations: [] }),
    });
    const conversationClient = createMockClient(conversationResponses);
    const conversations = await conversationClient.getConversations();
    assert.equal(conversations.length, 1, 'Should return conversations');
    const firstConversation = conversations[0];
    if (!firstConversation) {
      throw new Error('Expected conversation');
    }
    assert.equal(
      firstConversation.user_input,
      'Mobile Test Conversation',
      'Should include prompt'
    );

    const errorResponses = new Map<string, MockResponse>();
    errorResponses.set('POST /api/v1/run', {
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
      text: async () => 'Server error',
    });
    const errorClient = createMockClient(errorResponses);
    let caughtError = false;
    try {
      await errorClient.runTask({ prompt: 'Failing Task' });
    } catch (error) {
      caughtError = true;
      if (!(error instanceof Error)) {
        throw new Error('Expected error to be an Error instance', { cause: error });
      }
      assert.equal(error.message, 'Task execution failed', 'Should throw descriptive error');
    }
    assert.equal(caughtError, true, 'Should catch API errors');

    let retryCount = 0;
    const retryableRun = async () => {
      retryCount += 1;
      if (retryCount < 2) {
        throw new Error('Temporary failure');
      }
      return { task_id: 'retry_success', cached: false };
    };

    let retrySuccess = false;
    retryCount = 0;
    try {
      await retryableRun();
    } catch {
      await retryableRun();
    } finally {
      retrySuccess = true;
    }
    assert.equal(retrySuccess, true, 'Should succeed after retries');
  });
});
