import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

mock.restore();
await import('../../../../../tests/setup/dom');

const useFeatureFlagMock = vi.fn();
const renderMathInElementMock = vi.fn();
const highlightAllUnderMock = vi.fn();

vi.mock('@taskforceai/feature-flags', () => ({
  FEATURE_FLAGS: {
    ENABLE_LATEX_RENDERING_WEB: 'enable-latex-rendering-web',
  },
  useFeatureFlag: (flag: string) => useFeatureFlagMock(flag),
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) =>
      html.replace(/<([a-z][^>\s]*)([^>]*)>/gi, (_match, tag: string, attrs: string) => {
        const safeAttrs = attrs.replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
        return `<${tag}${safeAttrs}>`;
      })
    ),
  },
}));

vi.mock('katex/contrib/auto-render', () => ({
  default: renderMathInElementMock,
}));

vi.mock('marked', () => ({
  marked: {
    Renderer: class {
      table() {
        return '<table><thead><tr><th>Approach</th></tr></thead></table>';
      }
    },
    parse: vi.fn(
      (content: string, options?: { renderer?: { table: (_token: unknown) => string } }) =>
        content.includes('| Approach |')
          ? (options?.renderer?.table({ header: [], rows: [] }) ?? '<table></table>')
          : `<p>${content}</p>`
    ),
  },
}));

vi.mock('prismjs', () => ({
  default: {
    highlightAllUnder: highlightAllUnderMock,
  },
}));
vi.mock('prismjs/components/prism-bash', () => ({}));
vi.mock('prismjs/components/prism-go', () => ({}));
vi.mock('prismjs/components/prism-javascript', () => ({}));
vi.mock('prismjs/components/prism-json', () => ({}));
vi.mock('prismjs/components/prism-python', () => ({}));
vi.mock('prismjs/components/prism-rust', () => ({}));
vi.mock('prismjs/components/prism-typescript', () => ({}));
vi.mock('prismjs/components/prism-yaml', () => ({}));

const { render } = await import('@testing-library/react');
const { LATEX_RENDER_DELIMITERS } = await import('@taskforceai/shared/utils/math');
const DOMPurify = (await import('dompurify')).default;
// @ts-expect-error Bun can import the query-suffixed module to avoid cached mocks in this test.
const { default: ChunkedMarkdown } = await import('./ChunkedMarkdown.tsx?chunked-markdown-test');

describe('ChunkedMarkdown', () => {
  beforeEach(() => {
    useFeatureFlagMock.mockReset();
    renderMathInElementMock.mockReset();
    highlightAllUnderMock.mockReset();
  });

  it('renders content', () => {
    useFeatureFlagMock.mockReturnValue(true);
    const { container } = render(<ChunkedMarkdown content="Hello world" />);
    expect(container.textContent).toContain('Hello world');
  });

  it('renders empty content', () => {
    useFeatureFlagMock.mockReturnValue(true);
    const { container } = render(<ChunkedMarkdown content="" />);
    expect(container).toBeTruthy();
  });

  it('wraps markdown tables for contained horizontal scrolling', () => {
    useFeatureFlagMock.mockReturnValue(false);
    const { container } = render(<ChunkedMarkdown content="| Approach |\n| --- |\n| Sieve |" />);

    expect(container.querySelector('.markdown-table-scroll table')).toBeTruthy();
  });

  it('renders latex when the feature flag is enabled', () => {
    useFeatureFlagMock.mockReturnValue(true);
    render(<ChunkedMarkdown content={'Equation: \\(x^2\\)'} />);

    expect(renderMathInElementMock).toHaveBeenCalledTimes(1);
    expect(renderMathInElementMock.mock.calls[0]?.[1]).toMatchObject({
      delimiters: [...LATEX_RENDER_DELIMITERS],
      throwOnError: false,
    });
  });

  it('skips latex rendering when the feature flag is disabled', () => {
    useFeatureFlagMock.mockReturnValue(false);
    render(<ChunkedMarkdown content={'Equation: \\(x^2\\)'} />);

    expect(renderMathInElementMock).not.toHaveBeenCalled();
  });

  it('skips latex rendering when the content has no math delimiters', () => {
    useFeatureFlagMock.mockReturnValue(true);
    render(<ChunkedMarkdown content="No equations here" />);

    expect(renderMathInElementMock).not.toHaveBeenCalled();
  });

  it('allows generated media tags in sanitized markdown', () => {
    useFeatureFlagMock.mockReturnValue(false);
    render(
      <ChunkedMarkdown
        content={
          '<video controls preload="metadata"><source src="video.mp4" type="video/mp4"></video>'
        }
      />
    );

    expect(DOMPurify.sanitize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        ADD_TAGS: ['video', 'source'],
        ADD_ATTR: expect.arrayContaining(['controls', 'playsinline', 'preload', 'src', 'type']),
      })
    );
  });

  it('preserves event-handler-like text in normal markdown content', () => {
    useFeatureFlagMock.mockReturnValue(false);

    const { container } = render(
      <ChunkedMarkdown content={'The literal text onclick="alert(1)" should remain.'} />
    );

    expect(container.textContent).toContain('onclick="alert(1)"');
  });

  it('relies on DOMPurify to remove event handler attributes', () => {
    useFeatureFlagMock.mockReturnValue(false);

    const { container } = render(<ChunkedMarkdown content={'<img src="x" onclick="alert(1)">'} />);

    expect(container.innerHTML).not.toContain('onclick=');
    expect(container.innerHTML).toContain('src="x"');
  });
});
