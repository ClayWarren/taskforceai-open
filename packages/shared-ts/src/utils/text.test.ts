import { describe, expect, it } from 'bun:test';

import { buildRateLimitUpgradeMessage, capitalize, slugify, stripHtml, truncate } from './text';

describe('utils/text', () => {
  it('strips html tags without changing plain text content', () => {
    expect(stripHtml('<p>Hello <strong>TaskForceAI</strong></p>')).toBe('Hello TaskForceAI');
    expect(stripHtml('Plain text')).toBe('Plain text');
  });

  it('truncates by unicode code point and preserves strings within the limit', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('abcdef', 5)).toBe('ab...');
    expect(truncate('a😀bc', 4)).toBe('a😀bc');
    expect(truncate('a😀bcde', 5)).toBe('a😀...');
  });

  it('handles non-positive and tiny truncate limits', () => {
    expect(truncate('abcdef', -1)).toBe('');
    expect(truncate('abcdef', 0)).toBe('');
    expect(truncate('abcdef', 2)).toBe('..');
    expect(truncate('abcdef', 3)).toBe('...');
  });

  it('capitalizes only the first character', () => {
    expect(capitalize('taskForce')).toBe('TaskForce');
    expect(capitalize('')).toBe('');
  });

  it('slugifies punctuation and repeated separators', () => {
    expect(slugify('  TaskForce AI: Research_Lab!  ')).toBe('taskforce-ai-research-lab');
    expect(slugify('--Already__spaced--')).toBe('already-spaced');
  });

  it('builds plan-aware rate limit messages', () => {
    expect(buildRateLimitUpgradeMessage('pro')).toContain('upgrade to Super');
    expect(buildRateLimitUpgradeMessage('super')).toContain('Please wait');
    expect(buildRateLimitUpgradeMessage()).toContain('upgrade to Pro');
    expect(buildRateLimitUpgradeMessage('free')).toContain('upgrade to Pro');
  });
});
