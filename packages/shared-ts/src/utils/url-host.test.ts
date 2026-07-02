import { describe, expect, it } from 'bun:test';

import {
  extractHostFromCandidate,
  formatHostForHttpUrl,
  getObjectProp,
  getStringProp,
  isLocalDevBaseUrl,
} from './url-host';

describe('url host helpers', () => {
  it('reads guarded object properties', () => {
    expect(getStringProp({ hostUri: '127.0.0.1:8081' }, 'hostUri')).toBe('127.0.0.1:8081');
    expect(getStringProp({ hostUri: 3 }, 'hostUri')).toBe('');
    expect(getStringProp(null, 'hostUri')).toBe('');
    expect(getObjectProp({ extra: { expoGo: true } }, 'extra')).toEqual({ expoGo: true });
    expect(getObjectProp({ extra: null }, 'extra')).toBeUndefined();
    expect(getObjectProp('not-an-object', 'extra')).toBeUndefined();
  });

  it('extracts host values from common dev server candidates', () => {
    expect(extractHostFromCandidate('192.168.1.50:19000')).toBe('192.168.1.50');
    expect(extractHostFromCandidate('http://localhost:3000/foo')).toBe('localhost');
    expect(extractHostFromCandidate('[2001:db8::1]:8081')).toBe('2001:db8::1');
    expect(extractHostFromCandidate('2001:db8::1')).toBe('2001:db8::1');
    expect(extractHostFromCandidate('https://')).toBe('');
    expect(extractHostFromCandidate('/only/path')).toBe('');
    expect(extractHostFromCandidate('[missing-close')).toBe('');
    expect(extractHostFromCandidate('[]:8081')).toBe('');
    expect(extractHostFromCandidate('')).toBe('');
  });

  it('formats hosts for HTTP URLs and detects local dev URLs', () => {
    expect(formatHostForHttpUrl('2001:db8::1')).toBe('[2001:db8::1]');
    expect(formatHostForHttpUrl('[2001:db8::1]')).toBe('[2001:db8::1]');
    expect(formatHostForHttpUrl('localhost')).toBe('localhost');
    expect(isLocalDevBaseUrl('http://localhost:3000')).toBe(true);
    expect(isLocalDevBaseUrl('http://192.168.1.1:3000')).toBe(true);
    expect(isLocalDevBaseUrl('https://api.taskforceai.chat')).toBe(false);
  });
});
