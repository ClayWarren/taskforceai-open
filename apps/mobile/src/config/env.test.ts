import { describe, expect, it } from 'bun:test';
import { mobileEnv } from './env';

describe('mobile/config/env', () => {
  it('loads mobile environment configuration (Hardening TF-0425)', () => {
    expect(mobileEnv).toBeDefined();
    expect(mobileEnv.nodeEnv).toBeDefined();
    
    // Core properties should be accessible via the mapped envSource
    expect(typeof mobileEnv.api).toBe('object');
    expect(typeof mobileEnv.google).toBe('object');
  });

  it('provides helper to require Google Client ID', () => {
    // In test environment, this might throw if not set, but we just verify it's a function
    expect(typeof require('./env').requireGoogleClientId).toBe('function');
  });
});
