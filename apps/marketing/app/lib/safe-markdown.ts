import { marked, type Tokens } from 'marked';

const safeRenderer = new marked.Renderer();
safeRenderer.html = () => '';

const safeUrlPattern = /^(?:https?:|mailto:|tel:|\/(?!\/)|#)/i;

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isSafeUrl = (value: string): boolean => safeUrlPattern.test(value.trim());

safeRenderer.link = ({ href, title, tokens }: Tokens.Link): string => {
  const label = safeRenderer.parser.parseInline(tokens);
  if (!isSafeUrl(href)) {
    return `<a>${label}</a>`;
  }

  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<a href="${escapeAttribute(href)}"${titleAttribute}>${label}</a>`;
};

safeRenderer.image = ({ href, title, text }: Tokens.Image): string => {
  if (!isSafeUrl(href)) {
    return escapeAttribute(text);
  }

  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
};

export function renderMarkdownToSafeHtml(markdown: string): string {
  const rendered = marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer: safeRenderer,
  });

  const renderedString = typeof rendered === 'string' ? rendered : String(rendered);

  return renderedString;
}
