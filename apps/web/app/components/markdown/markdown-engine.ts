import DOMPurify from 'dompurify';
import { marked } from 'marked';

const markdownRenderer = new marked.Renderer();
const renderTable = markdownRenderer.table.bind(markdownRenderer);

markdownRenderer.table = (token) =>
  `<div class="markdown-table-scroll">${renderTable(token)}</div>`;

if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export const renderMarkdown = (content: string): string => {
  const rendered = marked.parse(content, {
    async: false,
    gfm: true,
    renderer: markdownRenderer,
  });
  const renderedString = typeof rendered === 'string' ? rendered : String(rendered);
  return DOMPurify.sanitize(renderedString, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['video', 'source'],
    ADD_ATTR: ['controls', 'playsinline', 'poster', 'preload', 'rel', 'src', 'target', 'type'],
  });
};
