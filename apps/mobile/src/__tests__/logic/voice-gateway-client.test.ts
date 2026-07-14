import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockEnv = {
  mobileEnv: {
    voiceGateway: {
      baseUrl: undefined as string | undefined,
    },
  },
};

const mockBaseUrl = {
  value: 'https://api.taskforceai.chat',
};

const pinnedFetch = (() => Promise.resolve(new Response())) as typeof fetch;
const mockToken = {
  value: 'mobile-token',
  ok: true,
};

mock.module('../../config/env', () => mockEnv);
mock.module('../../config/base-url', () => ({
  getMobileBaseUrl: () => mockBaseUrl.value,
}));
mock.module('../../api/client', () => ({
  getMobileAuthClient: () => ({
    getToken: async () => mockToken,
  }),
  getMobilePinnedFetch: () => pinnedFetch,
}));

const { createMobileVoiceGatewayRequestOptions, getMobileVoiceGatewayBaseUrl } = await import(
  '../../voice/voiceGatewayClient'
);

describe('mobile voice gateway client', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    mockEnv.mobileEnv.voiceGateway.baseUrl = undefined;
    mockBaseUrl.value = 'https://api.taskforceai.chat';
    mockToken.ok = true;
    mockToken.value = 'mobile-token';
  });

  it('defaults production voice media calls to the web deployment', () => {
    expect(getMobileVoiceGatewayBaseUrl()).toBe('https://www.taskforceai.chat');
  });

  it('uses the local mobile base URL in dev', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    mockBaseUrl.value = 'http://192.168.1.50:3000';

    expect(getMobileVoiceGatewayBaseUrl()).toBe('http://192.168.1.50:3000');
  });

  it('uses an explicit voice gateway URL override', () => {
    mockEnv.mobileEnv.voiceGateway.baseUrl = 'https://voice.example.test';

    expect(getMobileVoiceGatewayBaseUrl()).toBe('https://voice.example.test');
  });

  it('builds shared request options with pinned fetch and bearer auth', async () => {
    const options = await createMobileVoiceGatewayRequestOptions();

    expect(options.baseUrl).toBe('https://www.taskforceai.chat');
    expect(options.fetchImpl).toBe(pinnedFetch);
    expect(options.headers).toBeInstanceOf(Headers);
    expect((options.headers as Headers).get('authorization')).toBe('Bearer mobile-token');
    expect((options.headers as Headers).get('User-Agent')).toBe('TaskForceAI-Mobile');
  });
});
