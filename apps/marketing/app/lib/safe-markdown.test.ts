import { describe, expect, it } from 'bun:test';

import { renderMarkdownToSafeHtml } from './safe-markdown';

describe('renderMarkdownToSafeHtml', () => {
  it('drops raw html blocks before rendering markdown', () => {
    const html = renderMarkdownToSafeHtml('# Hi\n<script>alert("x")</script>');

    expect(html).toContain('<h1>Hi</h1>');
    expect(html).not.toContain('<script>');
  });

  it('removes unsafe generated link targets', () => {
    const html = renderMarkdownToSafeHtml(
      '[bad](javascript:alert(1)) [ok](https://taskforceai.chat)'
    );

    expect(html).toContain('<a>bad</a>');
    expect(html).toContain('href="https://taskforceai.chat"');
  });

  it('removes unsafe generated image targets', () => {
    const html = renderMarkdownToSafeHtml(
      '![bad](javascript:alert(1)) ![ok](/icon.png "TaskForceAI")'
    );

    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
    expect(html).toContain('<img src="/icon.png" alt="ok" title="TaskForceAI">');
  });
});
