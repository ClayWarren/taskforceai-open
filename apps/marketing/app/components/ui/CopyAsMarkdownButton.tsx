import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';

import { logger } from '@/lib/logger';
import { Button } from './button';

interface CopyAsMarkdownButtonProps {
  contentSelector?: string;
}

function htmlToMarkdown(element: Element): string {
  function processNode(
    node: Node,
    context: { inCode: boolean; inPre: boolean } = { inCode: false, inPre: false }
  ): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (context.inPre || context.inCode) {
        return text;
      }
      return text.replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();

    // Skip header, nav, and footer elements
    if (['header', 'nav', 'footer'].includes(tagName)) {
      return '';
    }

    // Skip elements that are just for styling/layout (buttons, links that are navigation)
    if (tagName === 'a' && el.getAttribute('href')?.startsWith('/')) {
      const text = el.textContent?.trim() || '';
      if (
        text.startsWith('←') ||
        text.startsWith('→') ||
        text === 'Home' ||
        text.includes('Back to')
      ) {
        return '';
      }
    }

    const children = Array.from(node.childNodes);

    switch (tagName) {
      case 'h1':
        return `# ${children
          .map((c) => processNode(c, context))
          .join('')
          .trim()}\n\n`;
      case 'h2':
        return `## ${children
          .map((c) => processNode(c, context))
          .join('')
          .trim()}\n\n`;
      case 'h3':
        return `### ${children
          .map((c) => processNode(c, context))
          .join('')
          .trim()}\n\n`;
      case 'h4':
        return `#### ${children
          .map((c) => processNode(c, context))
          .join('')
          .trim()}\n\n`;
      case 'p':
        const pContent = children
          .map((c) => processNode(c, context))
          .join('')
          .trim();
        return pContent ? `${pContent}\n\n` : '';
      case 'pre': {
        const preContent = children
          .map((c) => processNode(c, { ...context, inPre: true }))
          .join('');
        return `\`\`\`\n${preContent.trim()}\n\`\`\`\n\n`;
      }
      case 'code':
        if (context.inPre) {
          return children.map((c) => processNode(c, context)).join('');
        }
        return `\`${children.map((c) => processNode(c, { ...context, inCode: true })).join('')}\``;
      case 'strong':
      case 'b':
        return `**${children.map((c) => processNode(c, context)).join('')}**`;
      case 'em':
      case 'i':
        return `*${children.map((c) => processNode(c, context)).join('')}*`;
      case 'ul':
        return children.map((c) => processNode(c, context)).join('') + '\n';
      case 'ol':
        let counter = 1;
        return (
          children
            .map((c) => {
              if ((c as Element).tagName?.toLowerCase() === 'li') {
                const content = processNode(c, context).replace(/^- /, `${counter++}. `);
                return content;
              }
              return processNode(c, context);
            })
            .join('') + '\n'
        );
      case 'li':
        return `- ${children
          .map((c) => processNode(c, context))
          .join('')
          .trim()}\n`;
      case 'table': {
        const rows: string[][] = [];
        const headerRow: string[] = [];
        el.querySelectorAll('thead tr th').forEach((th) => {
          headerRow.push(th.textContent?.trim() || '');
        });
        if (headerRow.length > 0) {
          rows.push(headerRow);
          rows.push(headerRow.map(() => '---'));
        }
        el.querySelectorAll('tbody tr').forEach((tr) => {
          const row: string[] = [];
          tr.querySelectorAll('td').forEach((td) => {
            row.push(td.textContent?.trim() || '');
          });
          if (row.length > 0) {
            rows.push(row);
          }
        });
        if (rows.length > 0) {
          return rows.map((row) => `| ${row.join(' | ')} |`).join('\n') + '\n\n';
        }
        return '';
      }
      case 'br':
        return '\n';
      case 'div':
      case 'section':
      case 'main':
      case 'article':
        return children.map((c) => processNode(c, context)).join('');
      case 'span':
        return children.map((c) => processNode(c, context)).join('');
      case 'a': {
        const href = el.getAttribute('href');
        const text = children
          .map((c) => processNode(c, context))
          .join('')
          .trim();
        if (href && !href.startsWith('/') && text) {
          return `[${text}](${href})`;
        }
        return text;
      }
      case 'button':
        return '';
      default:
        return children.map((c) => processNode(c, context)).join('');
    }
  }

  const result = processNode(element);

  // Clean up: remove excessive newlines and trim
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function CopyAsMarkdownButton({ contentSelector = 'main' }: CopyAsMarkdownButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      const contentElement = document.querySelector(contentSelector);
      if (!contentElement) {
        logger.error('Content element not found for markdown copy', { contentSelector });
        return;
      }

      const markdown = htmlToMarkdown(contentElement);
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy markdown to clipboard', { error: err });
    }
  }, [contentSelector]);

  return (
    <Button
      variant="outline"
      onClick={() => {
        void handleCopy();
      }}
    >
      {copied ? (
        <>
          <Check className="mr-2 h-4 w-4" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="mr-2 h-4 w-4" />
          Copy as Markdown
        </>
      )}
    </Button>
  );
}
