/**
 * Maps internal error codes to user-friendly, localized message keys.
 * These keys should match entries in the translation files (e.g., en.json).
 */
export const ERROR_MESSAGE_KEYS: Record<string, string> = {
  ERR_INVALID_REQUEST: 'errors.invalid_request',
  ERR_DUPLICATE_USERNAME: 'errors.duplicate_username',
  ERR_DUPLICATE_EMAIL: 'errors.duplicate_email',
  ERR_NOT_FOUND: 'errors.not_found',
  ERR_UNAUTHORIZED: 'errors.unauthorized',
  ERR_FORBIDDEN: 'errors.forbidden',
  ERR_INTERNAL: 'errors.internal',

  // Chat-specific errors (likely from backend)
  ERR_SAFETY_FILTER_TRIGGERED: 'errors.chat.safety_filter',
  ERR_INSUFFICIENT_QUOTA: 'errors.chat.insufficient_quota',
  ERR_MODEL_NOT_AVAILABLE: 'errors.chat.model_unavailable',
  ERR_CONTEXT_WINDOW_EXCEEDED: 'errors.chat.context_exceeded',

  // Attachment errors
  ERR_FILE_TOO_LARGE: 'errors.attachments.too_large',
  ERR_UNSUPPORTED_FILE_TYPE: 'errors.attachments.unsupported_type',
  ERR_MAX_ATTACHMENTS_REACHED: 'errors.attachments.max_reached',
};

/**
 * Fallback message when an error code is unknown.
 */
export const DEFAULT_ERROR_MESSAGE_KEY = 'errors.unexpected';

/**
 * Returns the translation key for a given error code.
 */
export function getErrorMessageKey(code: string | undefined | null): string {
  if (!code) return DEFAULT_ERROR_MESSAGE_KEY;
  return ERROR_MESSAGE_KEYS[code] || DEFAULT_ERROR_MESSAGE_KEY;
}
