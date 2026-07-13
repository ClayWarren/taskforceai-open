import { describe, expect, it } from 'bun:test';
import { ERROR_MESSAGE_KEYS, DEFAULT_ERROR_MESSAGE_KEY, getErrorMessageKey } from './mapping';

describe('ERROR_MESSAGE_KEYS', () => {
  it('contains expected error codes', () => {
    expect(ERROR_MESSAGE_KEYS['ERR_INVALID_REQUEST']).toBe('errors.invalid_request');
    expect(ERROR_MESSAGE_KEYS['ERR_DUPLICATE_USERNAME']).toBe('errors.duplicate_username');
    expect(ERROR_MESSAGE_KEYS['ERR_DUPLICATE_EMAIL']).toBe('errors.duplicate_email');
    expect(ERROR_MESSAGE_KEYS['ERR_NOT_FOUND']).toBe('errors.not_found');
    expect(ERROR_MESSAGE_KEYS['ERR_UNAUTHORIZED']).toBe('errors.unauthorized');
    expect(ERROR_MESSAGE_KEYS['ERR_FORBIDDEN']).toBe('errors.forbidden');
    expect(ERROR_MESSAGE_KEYS['ERR_INTERNAL']).toBe('errors.internal');
  });

  it('contains chat-specific errors', () => {
    expect(ERROR_MESSAGE_KEYS['ERR_SAFETY_FILTER_TRIGGERED']).toBe('errors.chat.safety_filter');
    expect(ERROR_MESSAGE_KEYS['ERR_INSUFFICIENT_QUOTA']).toBe('errors.chat.insufficient_quota');
    expect(ERROR_MESSAGE_KEYS['ERR_MODEL_NOT_AVAILABLE']).toBe('errors.chat.model_unavailable');
    expect(ERROR_MESSAGE_KEYS['ERR_CONTEXT_WINDOW_EXCEEDED']).toBe('errors.chat.context_exceeded');
  });

  it('contains attachment errors', () => {
    expect(ERROR_MESSAGE_KEYS['ERR_FILE_TOO_LARGE']).toBe('errors.attachments.too_large');
    expect(ERROR_MESSAGE_KEYS['ERR_UNSUPPORTED_FILE_TYPE']).toBe(
      'errors.attachments.unsupported_type'
    );
    expect(ERROR_MESSAGE_KEYS['ERR_MAX_ATTACHMENTS_REACHED']).toBe(
      'errors.attachments.max_reached'
    );
  });
});

describe('DEFAULT_ERROR_MESSAGE_KEY', () => {
  it('is errors.unexpected', () => {
    expect(DEFAULT_ERROR_MESSAGE_KEY).toBe('errors.unexpected');
  });
});

describe('getErrorMessageKey', () => {
  it('returns mapped key for known codes', () => {
    expect(getErrorMessageKey('ERR_INVALID_REQUEST')).toBe('errors.invalid_request');
    expect(getErrorMessageKey('ERR_NOT_FOUND')).toBe('errors.not_found');
    expect(getErrorMessageKey('ERR_UNAUTHORIZED')).toBe('errors.unauthorized');
    expect(getErrorMessageKey('ERR_FORBIDDEN')).toBe('errors.forbidden');
  });

  it('returns default for unknown codes', () => {
    expect(getErrorMessageKey('UNKNOWN_CODE')).toBe(DEFAULT_ERROR_MESSAGE_KEY);
    expect(getErrorMessageKey('SOME_RANDOM_ERROR')).toBe(DEFAULT_ERROR_MESSAGE_KEY);
  });

  it('returns default for null', () => {
    expect(getErrorMessageKey(null)).toBe(DEFAULT_ERROR_MESSAGE_KEY);
  });

  it('returns default for undefined', () => {
    expect(getErrorMessageKey(undefined)).toBe(DEFAULT_ERROR_MESSAGE_KEY);
  });

  it('returns default for empty string', () => {
    expect(getErrorMessageKey('')).toBe(DEFAULT_ERROR_MESSAGE_KEY);
  });
});
