import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import React from 'react';

import { CodePanel } from './CodePanel';

describe('CodePanel', () => {
  const defaultProps: React.ComponentProps<typeof CodePanel> = {
    detailsId: 'test-panel',
    args: {
      code: 'print("hello")',
      language: 'python',
    },
    preview: {
      raw: 'hello\n',
    },
    highlight: null,
  };

  const renderPanel = (overrides: Partial<typeof defaultProps> = {}) =>
    render(<CodePanel {...defaultProps} {...overrides} />);

  test('renders code block with language label', () => {
    renderPanel();

    expect(screen.getByText('Python code')).toBeTruthy();
    expect(screen.getByText('print("hello")')).toBeTruthy();
  });

  test('renders highlighted code when highlight is provided', () => {
    renderPanel({
      highlight: {
        html: '<span class="token keyword">print</span>("hello")',
        languageClass: 'language-python',
      },
    });

    const codeElement = screen.getByText((_content, element) => {
      return (
        element?.tagName.toLowerCase() === 'code' && element.classList.contains('language-python')
      );
    });
    expect(codeElement.innerHTML).toContain('<span class="token keyword">print</span>("hello")');
  });

  test('sanitizes highlighted code markup', () => {
    renderPanel({
      highlight: {
        html: '<span class="token keyword" onclick="evil()">print</span><img src=x onerror="evil()">',
        languageClass: 'language-python',
      },
    });

    const codeElement = screen.getByText((_content, element) => {
      return (
        element?.tagName.toLowerCase() === 'code' && element.classList.contains('language-python')
      );
    });
    expect(codeElement.innerHTML).toContain('<span class="token keyword">print</span>');
    expect(codeElement.innerHTML).not.toContain('onclick');
    expect(codeElement.innerHTML).not.toContain('onerror');
    expect(codeElement.querySelector('img')).toBeNull();
  });

  test('renders output section', () => {
    renderPanel();

    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
  });

  test('renders errors section when present', () => {
    renderPanel({
      preview: {
        raw: '',
        errors: 'SyntaxError: unexpected token',
      },
    });

    expect(screen.getByText('Errors')).toBeTruthy();
    expect(screen.getByText('SyntaxError: unexpected token')).toBeTruthy();
  });

  test('renders timeout when provided', () => {
    renderPanel({
      args: {
        ...defaultProps.args,
        timeout: 5000,
      },
    });

    expect(screen.getByText('Timeout: 5s')).toBeTruthy();
  });

  test('renders resolved output from preview.output if available', () => {
    renderPanel({
      preview: {
        raw: 'raw output',
        output: 'processed output',
      },
    });

    expect(screen.getByText('processed output')).toBeTruthy();
    // Raw should not be displayed if output is present
    expect(screen.queryByText('raw output')).toBeNull();
  });
});
