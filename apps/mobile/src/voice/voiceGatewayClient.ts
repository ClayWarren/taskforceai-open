import type { VoiceGatewayRequestOptions } from '@taskforceai/client-runtime';

import { getMobileAuthClient, getMobilePinnedFetch } from '../api/client';
import { getMobileBaseUrl } from '../config/base-url';
import { mobileEnv } from '../config/env';

const PRODUCTION_VOICE_GATEWAY_URL = 'https://www.taskforceai.chat';

const isProductionApiBaseUrl = (url: string): boolean => /api\.taskforceai\.chat/i.test(url);

export const getMobileVoiceGatewayBaseUrl = (): string => {
  const configuredUrl = mobileEnv.voiceGateway?.baseUrl;
  if (configuredUrl) {
    return configuredUrl;
  }

  const apiBaseUrl = getMobileBaseUrl();
  if (__DEV__ && !isProductionApiBaseUrl(apiBaseUrl)) {
    return apiBaseUrl;
  }

  return PRODUCTION_VOICE_GATEWAY_URL;
};

export const createMobileVoiceGatewayRequestOptions =
  async (): Promise<VoiceGatewayRequestOptions> => {
    const headers = new Headers({ 'User-Agent': 'TaskForceAI-Mobile' });
    const tokenResult = await getMobileAuthClient().getToken();
    if (tokenResult.ok) {
      headers.set('authorization', `Bearer ${tokenResult.value}`);
    }

    return {
      baseUrl: getMobileVoiceGatewayBaseUrl(),
      fetchImpl: getMobilePinnedFetch(),
      headers,
    };
  };
