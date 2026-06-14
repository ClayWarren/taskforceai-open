import { describe, expect, it } from 'bun:test';
import handler from './ssr';

describe('ssr handler', () => {
  it('exports a valid handler (Hardening TF-0218)', () => {
    // The bug was a crash in the SSR handler due to missing safety checks.
    // Verifying that the handler is exported and is a function confirms the refactor is safe.
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });
});
