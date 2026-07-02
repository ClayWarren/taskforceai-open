import { describe, expect, it } from 'bun:test';

import { safeExternalHref } from './safe-url';

describe('safeExternalHref', () => {
  it('allows relative same-origin paths and HTTPS URLs', () => {
    expect(safeExternalHref('/api/v1/files/file-1/content')).toBe('/api/v1/files/file-1/content');
    expect(safeExternalHref(' https://files.example.com/report.pdf ')).toBe(
      'https://files.example.com/report.pdf'
    );
  });

  it('rejects missing, protocol-relative, non-HTTPS, and malformed URLs', () => {
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref('')).toBeNull();
    expect(safeExternalHref('//files.example.com/report.pdf')).toBeNull();
    expect(safeExternalHref('http://files.example.com/report.pdf')).toBeNull();
    expect(safeExternalHref('javascript:alert(1)')).toBeNull();
    expect(safeExternalHref('not a url')).toBeNull();
  });
});
