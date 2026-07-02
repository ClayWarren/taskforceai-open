/**
 * Shared analytics event names and property schemas to ensure consistency
 * across web, mobile, and desktop applications.
 */

export const ANALYTICS_EVENTS = {
  // Authentication & User
  AUTH_SIGN_IN: 'auth_sign_in',
  AUTH_SIGN_UP: 'auth_sign_up',
  AUTH_SIGN_OUT: 'auth_sign_out',

  // Chat & AI Interactions
  PROMPT_SUBMITTED: 'prompt_submitted',
  MESSAGE_RECEIVED: 'message_received',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_DELETED: 'conversation_deleted',
  MODEL_CHANGED: 'model_changed',

  // Voice & Media
  VOICE_RECORDING_STARTED: 'voice_recording_started',
  VOICE_RECORDING_STOPPED: 'voice_recording_stopped',
  FILE_ATTACHED: 'file_attached',

  // Subscription & Billing
  UPGRADE_CLICKED: 'upgrade_clicked',
  SUBSCRIPTION_STARTED: 'subscription_started',

  // System & UI
  THEME_CHANGED: 'theme_changed',
  APP_CRASHED: 'app_crashed',
  ERROR_ENCOUNTERED: 'error_encountered',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Common properties for analytics events.
 */
export interface CommonEventProperties {
  platform: 'web' | 'mobile' | 'desktop' | 'tui';
  version: string;
  is_authenticated: boolean;
  theme?: 'light' | 'dark' | 'system';
}

/**
 * Specific property definitions for key events.
 */
export interface EventPropertyMap {
  [ANALYTICS_EVENTS.PROMPT_SUBMITTED]: {
    model_id: string;
    attachment_count: number;
    has_image: boolean;
    is_voice: boolean;
    character_count: number;
  };
  [ANALYTICS_EVENTS.MODEL_CHANGED]: {
    from_model_id: string;
    to_model_id: string;
    trigger: 'manual' | 'auto';
  };
  [ANALYTICS_EVENTS.ERROR_ENCOUNTERED]: {
    error_code: string;
    error_message: string;
    feature: string;
  };
}
