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

const { act, render, waitFor } = await import('@testing-library/react');
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

  it('renders content', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    const { container } = render(<ChunkedMarkdown content="Hello world" />);
    await waitFor(() => {
      expect(container.textContent).toContain('Hello world');
    });
  });

  it('defers appended content updates while keeping the previous markdown visible', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    const { container, rerender } = render(<ChunkedMarkdown content="Streaming" />);

    await waitFor(() => {
      expect(container.textContent).toContain('Streaming');
    });

    rerender(<ChunkedMarkdown content="Streaming response" />);

    expect(container.textContent).toContain('Streaming');
    expect(container.textContent).not.toContain('Streaming response');
    await waitFor(() => {
      expect(container.textContent).toContain('Streaming response');
    });
  });

  it('throttles fast appended updates without resetting the render deadline', async () => {
    vi.useFakeTimers();
    try {
      useFeatureFlagMock.mockReturnValue(false);
      const { container, rerender } = render(<ChunkedMarkdown content="Streaming" />);

      await waitFor(() => {
        expect(container.textContent).toContain('Streaming');
      });

      await act(async () => {
        rerender(<ChunkedMarkdown content="Streaming r" />);
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      await act(async () => {
        rerender(<ChunkedMarkdown content="Streaming response" />);
      });
      await act(async () => {
        vi.advanceTimersByTime(24);
      });

      expect(container.textContent).toContain('Streaming');
      expect(container.textContent).not.toContain('Streaming response');

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(container.textContent).toContain('Streaming response');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not defer the first streamed content update from an empty placeholder', async () => {
    useFeatureFlagMock.mockReturnValue(false);

    const { container, rerender } = render(<ChunkedMarkdown content="" />);
    await act(async () => {
      rerender(<ChunkedMarkdown content="First token" />);
    });

    expect(container.textContent).toContain('First token');
  });

  it('renders empty content', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    const { container } = render(<ChunkedMarkdown content="" />);
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });

  it('wraps markdown tables for contained horizontal scrolling', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    const { container } = render(<ChunkedMarkdown content="| Approach |\n| --- |\n| Sieve |" />);

    await waitFor(() => {
      expect(container.querySelector('.markdown-table-scroll table')).toBeTruthy();
    });
  });

  it('renders latex when the feature flag is enabled', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    render(<ChunkedMarkdown content={'Equation: \\(x^2\\)'} />);

    await waitFor(() => {
      expect(renderMathInElementMock).toHaveBeenCalledTimes(1);
    });
    expect(renderMathInElementMock.mock.calls[0]?.[1]).toMatchObject({
      delimiters: [...LATEX_RENDER_DELIMITERS],
      throwOnError: false,
    });
  });

  it('skips latex rendering when the feature flag is disabled', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    const { container } = render(<ChunkedMarkdown content={'Equation: \\(x^2\\)'} />);

    await waitFor(() => {
      expect(container.textContent).toContain('Equation: \\(x^2\\)');
    });
    expect(renderMathInElementMock).not.toHaveBeenCalled();
  });

  it('skips latex rendering when the content has no math delimiters', async () => {
    useFeatureFlagMock.mockReturnValue(true);
    const { container } = render(<ChunkedMarkdown content="No equations here" />);

    await waitFor(() => {
      expect(container.textContent).toContain('No equations here');
    });
    expect(renderMathInElementMock).not.toHaveBeenCalled();
  });

  it('loads syntax highlighting when rendered markdown contains a code block', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    render(<ChunkedMarkdown content={'```ts\nconst answer = 42;\n```'} />);

    await waitFor(() => {
      expect(highlightAllUnderMock).toHaveBeenCalledTimes(1);
    });
  });

  it('allows generated media tags in sanitized markdown', async () => {
    useFeatureFlagMock.mockReturnValue(false);
    render(
      <ChunkedMarkdown
        content={
          '<video controls preload="metadata"><source src="video.mp4" type="video/mp4"></video>'
        }
      />
    );

    await waitFor(() => {
      expect(DOMPurify.sanitize).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ADD_TAGS: ['video', 'source'],
          ADD_ATTR: expect.arrayContaining(['controls', 'playsinline', 'preload', 'src', 'type']),
        })
      );
    });
  });

  it('preserves event-handler-like text in normal markdown content', async () => {
    useFeatureFlagMock.mockReturnValue(false);

    const { container } = render(
      <ChunkedMarkdown content={'The literal text onclick="alert(1)" should remain.'} />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('onclick="alert(1)"');
    });
  });

  it('relies on DOMPurify to remove event handler attributes', async () => {
    useFeatureFlagMock.mockReturnValue(false);

    const { container } = render(<ChunkedMarkdown content={'<img src="x" onclick="alert(1)">'} />);

    await waitFor(() => {
      expect(container.innerHTML).not.toContain('onclick=');
      expect(container.innerHTML).toContain('src="x"');
    });
  });
});
