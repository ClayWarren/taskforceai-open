import { describe, expect, it } from 'bun:test';

import {
  validateCredentials,
  validateEmailOrUsername,
  validatePasswordMatch,
  validateResetToken,
} from './validation-fallbacks';

describe('validation fallback helpers', () => {
  it('requires username and password credentials', () => {
    expect(validateCredentials('', 'password')).toEqual({
      valid: false,
      error: 'Please enter username and password',
    });
    expect(validateCredentials('user', 'password')).toEqual({ valid: true });
  });

  it('requires both reset token and user id', () => {
    expect(validateResetToken('token', null)).toEqual({
      valid: false,
      error: 'This reset link is invalid. Please request a new one.',
    });
    expect(validateResetToken('token', 'user')).toEqual({ valid: true });
  });

  it('checks password length before matching', () => {
    expect(validatePasswordMatch('short', 'different')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters long.',
    });
    expect(validatePasswordMatch('long-password', 'different')).toEqual({
      valid: false,
      error: 'Passwords do not match.',
    });
    expect(validatePasswordMatch('secret', 'secret', 6)).toEqual({ valid: true });
  });

  it('rejects blank email or username identifiers', () => {
    expect(validateEmailOrUsername('   ')).toEqual({
      valid: false,
      error: 'Please enter your username or email.',
    });
    expect(validateEmailOrUsername('test@example.com')).toEqual({ valid: true });
  });
});
