import { describe, expect, it } from 'bun:test';

import { isValidEmail, isValidUrl } from './validation';

describe('utils/validation', () => {
  it('accepts syntactically valid email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.co')).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('missing-at.example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });

  it('accepts only http and https urls', () => {
    expect(isValidUrl('https://taskforce.ai')).toBe(true);
    expect(isValidUrl('http://localhost:3000/path?x=1')).toBe(true);
    expect(isValidUrl('ftp://taskforce.ai')).toBe(false);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
  });
});
