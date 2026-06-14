import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { ToolUsageEvent } from '../../types';

jest.mock('../../components/ToolUsageList.styles', () => ({
  styles: {
    section: { padding: 8 },
    sectionText: { fontSize: 14 },
    sectionHeading: { fontWeight: '600' },
    chipRow: { flexDirection: 'row' },
    chip: { padding: 4 },
    chipText: { fontSize: 12 },
    codeBlock: { backgroundColor: '#1e1e1e' },
    codeText: { fontFamily: 'monospace' },
    logBlock: { backgroundColor: '#f5f5f5' },
    logText: { fontFamily: 'monospace' },
  },
}));

const mockOpenLink = jest.fn();

jest.spyOn(Linking, 'openURL').mockImplementation(() => {
  mockOpenLink();
  return Promise.resolve();
});

const {
  SearchContent,
  CodeContent,
  GenericContent,
} = require('../../components/ToolUsageList.content') as typeof import('../../components/ToolUsageList.content');

describe('SearchContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search label, limited chips, total, and opens links', () => {
    mockOpenLink.mockClear();
    const preview = {
      links: [
        { url: 'https://one.com', title: 'One' },
        { url: 'https://two.com', title: 'Two' },
        { url: 'https://three.com', title: 'Three' },
        { url: 'https://four.com', title: 'Four' },
      ],
      totalResults: 42,
    };
    const { getByText, queryByText } = render(<SearchContent preview={preview} />);
    expect(getByText('Search results')).toBeTruthy();
    expect(queryByText('one.com')).toBeTruthy();
    expect(queryByText('two.com')).toBeTruthy();
    expect(queryByText('three.com')).toBeTruthy();
    expect(queryByText('four.com')).toBeNull();
    expect(getByText('42 results')).toBeTruthy();

    fireEvent.press(getByText('one.com'));
    expect(mockOpenLink).toHaveBeenCalledTimes(1);
  });
});

describe('CodeContent', () => {
  const createCodePreview = (overrides: Record<string, unknown> = {}) => ({
    ...overrides,
  });

  const createCodeArgs = (overrides: Record<string, unknown> = {}) => ({
    ...overrides,
  });

  it('renders code with language, output, errors, and raw fallback', () => {
    const codeArgs = createCodeArgs({ code: 'print("hello")', language: 'python' });
    const { getByText, rerender } = render(
      <CodeContent codeArgs={codeArgs} codePreview={createCodePreview()} />
    );
    expect(getByText('print("hello")')).toBeTruthy();
    expect(getByText('Python code')).toBeTruthy();

    rerender(
      <CodeContent codeArgs={createCodeArgs()} codePreview={createCodePreview({ output: 'Hello, World!' })} />
    );
    expect(getByText('Hello, World!')).toBeTruthy();

    rerender(
      <CodeContent
        codeArgs={createCodeArgs()}
        codePreview={createCodePreview({ errors: 'Error: something failed' })}
      />
    );
    expect(getByText('Error: something failed')).toBeTruthy();

    rerender(
      <CodeContent codeArgs={createCodeArgs()} codePreview={createCodePreview({ raw: 'raw output' })} />
    );
    expect(getByText('raw output')).toBeTruthy();
  });
});

describe('GenericContent', () => {
  const createEvent = (overrides: Partial<ToolUsageEvent> = {}): ToolUsageEvent => ({
    agentLabel: 'Agent',
    toolName: 'test_tool',
    arguments: {},
    success: true,
    durationMs: 1000,
    timestamp: Date.now(),
    ...overrides,
  });

  it('renders resultPreview when present', () => {
    const event = createEvent({ resultPreview: 'Preview result' });
    const { getByText } = render(<GenericContent event={event} />);
    expect(getByText('Preview result')).toBeTruthy();
  });

  it('renders arguments when no resultPreview and args.ok', () => {
    const event = createEvent({ arguments: { foo: 'bar' } });
    const { getByText } = render(<GenericContent event={event} />);
    expect(getByText('Arguments')).toBeTruthy();
  });

  it('returns null when no resultPreview and args not ok', () => {
    const event = createEvent({ resultPreview: undefined, arguments: null });
    const { toJSON } = render(<GenericContent event={event} />);
    expect(toJSON()).toBeNull();
  });
});
