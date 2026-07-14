declare module 'katex/contrib/auto-render' {
  interface AutoRenderDelimiter {
    left: string;
    right: string;
    display: boolean;
  }

  interface AutoRenderOptions {
    delimiters?: AutoRenderDelimiter[];
    ignoredTags?: string[];
    throwOnError?: boolean;
  }

  export default function renderMathInElement(element: Element, options?: AutoRenderOptions): void;
}
