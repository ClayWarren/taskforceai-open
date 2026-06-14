import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

const safeRenderer = new marked.Renderer();
safeRenderer.html = () => '';

export function renderMarkdownToSafeHtml(markdown: string): string {
  const rendered = marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer: safeRenderer,
  });

  const renderedString = typeof rendered === 'string' ? rendered : String(rendered);

  return DOMPurify.sanitize(renderedString);
}
