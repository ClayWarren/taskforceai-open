import { describe, it, expect } from 'bun:test';
import { getServerBaseUrl } from '@taskforceai/config/server-base-url';

describe('getServerBaseUrl', () => {
  it('prefers NEXT_PUBLIC_API_URL', () => {
    const env = { NEXT_PUBLIC_API_URL: 'https://api.example.com/' };
    expect(getServerBaseUrl(env as any)).toBe('https://api.example.com');
  });

  it('uses VERCEL_URL if API URL is missing', () => {
    const env = { VERCEL_URL: 'taskforce-status.vercel.app' };
    expect(getServerBaseUrl(env as any)).toBe('https://taskforce-status.vercel.app');
  });

  it('falls back to localhost if nothing else is provided', () => {
    const env = { PORT: '4000' };
    expect(getServerBaseUrl(env as any)).toBe('http://localhost:4000');
  });

  it('defaults to port 3000 if PORT is missing', () => {
    const env = {};
    expect(getServerBaseUrl(env as any)).toBe('http://localhost:3000');
  });
});
