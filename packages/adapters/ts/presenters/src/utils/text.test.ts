import { describe, expect, it } from 'bun:test';

import { buildRateLimitUpgradeMessage, capitalize, slugify, stripHtml, truncate } from './text';

describe('text presenters', () => {
  it('formats display text', () => {
    expect(stripHtml('<p>Hello <strong>TaskForceAI</strong></p>')).toBe('Hello TaskForceAI');
    expect(stripHtml('Plain text')).toBe('Plain text');
    expect(capitalize('taskForce')).toBe('TaskForce');
    expect(capitalize('')).toBe('');
    expect(slugify('  TaskForce AI: Research_Lab!  ')).toBe('taskforce-ai-research-lab');
    expect(slugify('--Already__spaced--')).toBe('already-spaced');
  });

  it('truncates by Unicode code point and respects small limits', () => {
    expect(truncate('abcdef', 5)).toBe('ab...');
    expect(truncate('hi', 10)).toBe('hi');
    expect(truncate('abcdef', 3)).toBe('...');
    expect(truncate('abcdef', 0)).toBe('');
    expect(truncate('abcdef', -1)).toBe('');
    expect(truncate('abcdef', 2)).toBe('..');
    expect(truncate('hello 👋 world', 10)).toBe('hello 👋...');
  });

  it('builds plan-specific rate-limit messages', () => {
    expect(buildRateLimitUpgradeMessage()).toContain('upgrade to Pro');
    expect(buildRateLimitUpgradeMessage('pro')).toContain('upgrade to Super');
    expect(buildRateLimitUpgradeMessage('super')).not.toContain('upgrade');
  });
});
