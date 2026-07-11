import {
  type MessageResponse,
  type MFAStatusResponse,
  type SettingsResponse,
  authenticatedUserSchema,
  messageResponseSchema,
  mfaLoginResponseSchema,
  mfaSetupResponseSchema,
  mfaStatusResponseSchema,
  planSchema,
  registerUserSchema,
  settingsResponseSchema,
  themeSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, type RequestContext } from './helpers';
import { type Result } from '../utils/result';
import { ApiClientError } from '../request';

export const createAuthClient = (context: RequestContext) => {
  const { get, post, request, result, buildJsonHeaders } = createHelpers(context);

  return {
    register: (d: unknown) =>
      post('/api/v1/auth/register', registerUserSchema.parse(d), authenticatedUserSchema),
    logout: async () => {
      try {
        await request('/api/v1/auth/logout', { method: 'POST' }, { parseJson: false });
      } catch (e) {
        // Ignored if logout returns 404 (already logged out)
        if (!(e instanceof ApiClientError && e.status === 404)) {
          throw e;
        }
      }
    },
    currentUser: (init: RequestInit = {}) => get('/api/v1/auth/me', authenticatedUserSchema, init),
    getMFAStatus: () => get('/api/v1/auth/mfa', mfaStatusResponseSchema),
    setupAuthenticatorMFA: () =>
      post('/api/v1/auth/mfa/authenticator/setup', {}, mfaSetupResponseSchema),
    verifyAuthenticatorMFA: (code: string) =>
      post('/api/v1/auth/mfa/authenticator/verify', { code }, mfaStatusResponseSchema),
    disableAuthenticatorMFA: async (code: string): Promise<MFAStatusResponse> =>
      mfaStatusResponseSchema.parse(
        await request('/api/v1/auth/mfa/authenticator', {
          method: 'DELETE',
          headers: buildJsonHeaders(),
          body: JSON.stringify({ code }),
        })
      ),
    verifyAuthenticatorMFALogin: (code: string, mfaToken?: string) =>
      post(
        '/api/v1/auth/mfa/authenticator/login',
        mfaToken ? { code, mfa_token: mfaToken } : { code },
        mfaLoginResponseSchema
      ),
    updateSettings: async (s: {
      full_name?: string;
      theme_preference?: string;
      memory_enabled?: boolean;
      web_search_enabled?: boolean;
      code_execution_enabled?: boolean;
      notifications_enabled?: boolean;
      quick_mode_enabled?: boolean;
      trust_layer_enabled?: boolean;
    }): Promise<Result<SettingsResponse>> =>
      result(settingsResponseSchema, () =>
        request('/api/v1/auth/settings', {
          method: 'PUT',
          headers: buildJsonHeaders(),
          body: JSON.stringify(s),
        })
      ),
    updateTheme: (t: unknown): Promise<Result<MessageResponse>> =>
      result(messageResponseSchema, () =>
        request(`/api/v1/auth/theme?theme=${encodeURIComponent(themeSchema.parse(t))}`, {
          method: 'PUT',
        })
      ),
    upgradePlan: (p: unknown): Promise<Result<MessageResponse>> =>
      result(messageResponseSchema, () =>
        request(`/api/v1/auth/upgrade?plan=${encodeURIComponent(planSchema.parse(p))}`, {
          method: 'PUT',
        })
      ),
  };
};
