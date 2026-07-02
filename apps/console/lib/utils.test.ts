import { describe, expect, it } from 'bun:test';

import { cn, variants } from './utils';

describe('console utils', () => {
  it('merges conditional class names and resolves Tailwind conflicts', () => {
    expect(cn('px-2 text-sm', false, null, undefined, ['font-semibold', 'px-4'])).toBe(
      'text-sm font-semibold px-4'
    );
  });

  it('re-exports class variance authority as variants', () => {
    const button = variants('inline-flex', {
      variants: {
        tone: {
          primary: 'text-blue-600',
          danger: 'text-red-600',
        },
      },
      defaultVariants: {
        tone: 'primary',
      },
    });

    expect(button()).toBe('inline-flex text-blue-600');
    expect(button({ tone: 'danger' })).toBe('inline-flex text-red-600');
  });
});
