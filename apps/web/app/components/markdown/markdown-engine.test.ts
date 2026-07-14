import { beforeEach, describe, expect, it, vi } from 'bun:test';

await import('../../../../../tests/setup/dom');

const addHookMock = vi.fn();
const markedParseMock = vi.fn();
let sanitizeOptions: Record<string, unknown> | null = null;
let afterSanitizeAttributesHook: ((node: Element) => void) | null = null;

vi.mock('dompurify', () => ({
  default: {
    addHook: addHookMock,
    sanitize: vi.fn((html: string, options: Record<string, unknown>) => {
      sanitizeOptions = options;
      const container = document.createElement('div');
      container.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      for (const element of Array.from(container.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name.toLowerCase().startsWith('on')) {
            element.removeAttribute(attribute.name);
          }
        }
        afterSanitizeAttributesHook?.(element);
      }
      return container.innerHTML;
    }),
  },
}));

vi.mock('marked', () => ({
  marked: {
    Renderer: class {
      table() {
        return '<table><tbody><tr><td>Sieve</td></tr></tbody></table>';
      }
    },
    parse: markedParseMock,
  },
}));

addHookMock.mockImplementation((hookName: string, callback: (node: Element) => void) => {
  if (hookName === 'afterSanitizeAttributes') {
    afterSanitizeAttributesHook = callback;
  }
});

const { renderMarkdown } = await import('./markdown-engine');
const DOMPurify = (await import('dompurify')).default;

describe('renderMarkdown', () => {
  beforeEach(() => {
    markedParseMock.mockReset();
    (DOMPurify.sanitize as ReturnType<typeof vi.fn>).mockClear();
    sanitizeOptions = null;
  });

  it('wraps rendered markdown tables in a horizontal scroll container', () => {
    markedParseMock.mockImplementationOnce(
      (_content: string, options: { renderer: { table: (token: unknown) => string } }) =>
        options.renderer.table({ header: [], rows: [] })
    );

    const html = renderMarkdown('| Approach |\n| --- |\n| Sieve |');

    expect(html).toContain('class="markdown-table-scroll"');
    expect(html).toContain('<table>');
    expect(html).toContain('Sieve');
  });

  it('sanitizes rendered markdown with the generated-media allowlist', () => {
    markedParseMock.mockReturnValueOnce(
      '<p>Literal onclick="alert(1)"</p><img src="x" onerror="alert(1)"><script>alert(1)</script>'
    );

    const html = renderMarkdown('unsafe markdown');

    expect(html).toContain('Literal onclick="alert(1)"');
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('<script>');
    expect(sanitizeOptions).toMatchObject({
      USE_PROFILES: { html: true },
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: expect.arrayContaining([
        'controls',
        'playsinline',
        'poster',
        'preload',
        'rel',
        'src',
        'target',
        'type',
      ]),
    });
  });

  it('adds noopener and noreferrer to sanitized links opened in a new tab', () => {
    markedParseMock.mockReturnValueOnce(
      '<a href="https://example.com" target="_blank">Example</a>'
    );

    const html = renderMarkdown('link');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('coerces non-string marked output before sanitizing', () => {
    markedParseMock.mockReturnValueOnce({ toString: () => '<p>object output</p>' });

    const html = renderMarkdown('object output');

    expect(html).toContain('object output');
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<p>object output</p>', expect.any(Object));
  });
});
