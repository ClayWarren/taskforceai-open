export interface LatexRenderDelimiter {
  left: string;
  right: string;
  display: boolean;
}

export interface MarkdownLatexSegment {
  type: 'markdown' | 'inline-math' | 'block-math';
  raw: string;
  expression?: string;
}

export const LATEX_RENDER_DELIMITERS: readonly LatexRenderDelimiter[] = Object.freeze([
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
]);

const INLINE_CODE_DELIMITER = '`';
const FENCED_CODE_DELIMITER = '```';

const findInlineCodeEnd = (content: string, start: number): number => {
  return content.indexOf(INLINE_CODE_DELIMITER, start + INLINE_CODE_DELIMITER.length);
};

const findFencedCodeEnd = (content: string, start: number): number => {
  return content.indexOf(FENCED_CODE_DELIMITER, start + FENCED_CODE_DELIMITER.length);
};

const findMathOpen = (content: string, start: number): LatexRenderDelimiter | null => {
  for (const delimiter of LATEX_RENDER_DELIMITERS) {
    if (content.startsWith(delimiter.left, start)) {
      return delimiter;
    }
  }

  return null;
};

export const splitMarkdownAndLatex = (content: string): MarkdownLatexSegment[] => {
  if (!content) {
    return [];
  }

  const segments: MarkdownLatexSegment[] = [];
  let markdownBuffer = '';
  let index = 0;

  const flushMarkdown = () => {
    if (!markdownBuffer) {
      return;
    }

    segments.push({ type: 'markdown', raw: markdownBuffer });
    markdownBuffer = '';
  };

  while (index < content.length) {
    if (content.startsWith(FENCED_CODE_DELIMITER, index)) {
      const fencedCodeEnd = findFencedCodeEnd(content, index);

      if (fencedCodeEnd === -1) {
        markdownBuffer += content.slice(index);
        break;
      }

      markdownBuffer += content.slice(index, fencedCodeEnd + FENCED_CODE_DELIMITER.length);
      index = fencedCodeEnd + FENCED_CODE_DELIMITER.length;
      continue;
    }

    if (content.startsWith(INLINE_CODE_DELIMITER, index)) {
      const inlineCodeEnd = findInlineCodeEnd(content, index);

      if (inlineCodeEnd === -1) {
        markdownBuffer += content.slice(index);
        break;
      }

      markdownBuffer += content.slice(index, inlineCodeEnd + INLINE_CODE_DELIMITER.length);
      index = inlineCodeEnd + INLINE_CODE_DELIMITER.length;
      continue;
    }

    const delimiter = findMathOpen(content, index);

    if (!delimiter) {
      markdownBuffer += content[index];
      index += 1;
      continue;
    }

    const mathEnd = content.indexOf(delimiter.right, index + delimiter.left.length);

    if (mathEnd === -1) {
      markdownBuffer += content.slice(index);
      break;
    }

    flushMarkdown();

    const raw = content.slice(index, mathEnd + delimiter.right.length);
    segments.push({
      type: delimiter.display ? 'block-math' : 'inline-math',
      raw,
      expression: content.slice(index + delimiter.left.length, mathEnd),
    });

    index = mathEnd + delimiter.right.length;
  }

  flushMarkdown();

  return segments;
};

export const containsLatexMath = (content: string): boolean => {
  return splitMarkdownAndLatex(content).some((segment) => segment.type !== 'markdown');
};
