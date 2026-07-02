import { describe, expect, it } from 'bun:test';

const path = require('../../../shims/path');

describe('mobile path shim', () => {
  it('normalizes joined path segments', () => {
    expect(path.join('alpha/', '/beta', '.', 'gamma')).toBe('alpha/beta/gamma');
    expect(path.join('alpha', '..', 'beta')).toBe('beta');
  });

  it('resets resolution when an absolute segment is provided', () => {
    expect(path.resolve('alpha', 'beta', '/root', 'child')).toBe('/root/child');
    expect(path.resolve('/root', 'child', '..', 'next')).toBe('/root/next');
  });

  it('returns stable directory names', () => {
    expect(path.dirname('/root/child/file.txt')).toBe('/root/child');
    expect(path.dirname('/root')).toBe('/');
    expect(path.dirname('file.txt')).toBe('.');
  });
});
