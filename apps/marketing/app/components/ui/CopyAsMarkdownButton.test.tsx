import '@testing-library/jest-dom';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const logger = {
  error: vi.fn(),
};

vi.mock('@/lib/logger', () => ({
  logger,
}));

const { CopyAsMarkdownButton } = await import('./CopyAsMarkdownButton');

describe('CopyAsMarkdownButton', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('copies selected page content as normalized markdown', async () => {
    render(
      <>
        <main>
          <header>Hidden header</header>
          <h1>Copy Guide</h1>
          <p>
            Hello <strong>bold</strong> and <em>italic</em> with <code>inline()</code>.
          </p>
          <pre>
            <code>{'const value = 1;'}</code>
          </pre>
          <ul>
            <li>First item</li>
            <li>Second item</li>
          </ul>
          <ol>
            <li>Step one</li>
            <li>Step two</li>
          </ol>
          <p>
            <a href="https://example.com/docs">External docs</a>
            <a href="/home">Home</a>
          </p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>API</td>
                <td>Online</td>
              </tr>
            </tbody>
          </table>
          <footer>Hidden footer</footer>
        </main>
        <CopyAsMarkdownButton />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: /copy as markdown/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`# Copy Guide

Hello **bold** and *italic* with \`inline()\`.

\`\`\`
const value = 1;
\`\`\`

- First item
- Second item

1. Step one
2. Step two

[External docs](https://example.com/docs)

| Name | Status |
| --- | --- |
| API | Online |`);
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('logs when the configured content selector is missing', async () => {
    render(<CopyAsMarkdownButton contentSelector="#missing" />);

    fireEvent.click(screen.getByRole('button', { name: /copy as markdown/i }));

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('Content element not found for markdown copy', {
        contentSelector: '#missing',
      })
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('handles headings, wrapper elements, relative links, and empty structural nodes', async () => {
    render(
      <>
        <section
          id="edge-content"
          dangerouslySetInnerHTML={{
            __html: `
              <!-- ignored comment -->
              <article>
                <h2>Section</h2>
                <h3>Detail</h3>
                <h4>Small</h4>
                <p><span>Line one</span><br><span>line two</span></p>
                <ol><div>Loose intro</div><li>First step</li></ol>
                <p>
                  <a href="/docs">Docs</a>
                  <a href="/previous">← Back</a>
                  <button>Ignore button</button>
                </p>
                <table></table>
                <custom-element>Custom text</custom-element>
              </article>
            `,
          }}
        />
        <CopyAsMarkdownButton contentSelector="#edge-content" />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: /copy as markdown/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const markdown = writeText.mock.calls[0]?.[0] as string;
    expect(markdown).toContain('## Section');
    expect(markdown).toContain('### Detail');
    expect(markdown).toContain('#### Small');
    expect(markdown).toContain('Line one\nline two');
    expect(markdown).toContain('Loose intro1. First step');
    expect(markdown).toContain('Docs');
    expect(markdown).toContain('Custom text');
    expect(markdown).not.toContain('ignored comment');
    expect(markdown).not.toContain('← Back');
    expect(markdown).not.toContain('Ignore button');
  });

  it('logs clipboard failures without changing to the copied state', async () => {
    const error = new Error('clipboard denied');
    writeText.mockRejectedValue(error);

    render(
      <>
        <main>
          <h1>Copy Guide</h1>
        </main>
        <CopyAsMarkdownButton />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: /copy as markdown/i }));

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('Failed to copy markdown to clipboard', { error })
    );
    expect(screen.getByRole('button', { name: /copy as markdown/i })).toBeInTheDocument();
  });
});
