import { describe, expect, it } from 'bun:test';

import { ANALYTICS_EVENTS } from './events';

describe('analytics/events', () => {
  it('exports stable analytics event names used across clients', () => {
    expect(ANALYTICS_EVENTS).toMatchObject({
      AUTH_SIGN_IN: 'auth_sign_in',
      AUTH_SIGN_UP: 'auth_sign_up',
      AUTH_SIGN_OUT: 'auth_sign_out',
      PROMPT_SUBMITTED: 'prompt_submitted',
      MESSAGE_RECEIVED: 'message_received',
      CONVERSATION_CREATED: 'conversation_created',
      CONVERSATION_DELETED: 'conversation_deleted',
      MODEL_CHANGED: 'model_changed',
      VOICE_RECORDING_STARTED: 'voice_recording_started',
      VOICE_RECORDING_STOPPED: 'voice_recording_stopped',
      FILE_ATTACHED: 'file_attached',
      UPGRADE_CLICKED: 'upgrade_clicked',
      SUBSCRIPTION_STARTED: 'subscription_started',
      THEME_CHANGED: 'theme_changed',
      APP_CRASHED: 'app_crashed',
      ERROR_ENCOUNTERED: 'error_encountered',
    });
  });
});
