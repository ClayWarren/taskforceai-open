import { LATEX_RENDER_DELIMITERS } from '@taskforceai/presenters/utils/math';
import 'katex/dist/katex.min.css';
import renderMathInElement from 'katex/contrib/auto-render';

export const renderLatex = (element: HTMLElement): void => {
  renderMathInElement(element, {
    delimiters: [...LATEX_RENDER_DELIMITERS],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
    throwOnError: false,
  });
};
