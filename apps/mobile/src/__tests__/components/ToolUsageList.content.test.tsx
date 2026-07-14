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

jest.spyOn(Linking, 'openURL').mockImplementation((url) => {
  mockOpenLink(url);
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

  it('renders search label, limited chips, total, and opens links', async () => {
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
    const { getByText, queryByText } = await render(<SearchContent preview={preview} />);
    expect(getByText('Search results')).toBeTruthy();
    expect(queryByText('one.com')).toBeTruthy();
    expect(queryByText('two.com')).toBeTruthy();
    expect(queryByText('three.com')).toBeTruthy();
    expect(queryByText('four.com')).toBeNull();
    expect(getByText('42 results')).toBeTruthy();

    await fireEvent.press(getByText('one.com'));
    expect(mockOpenLink).toHaveBeenCalledWith('https://one.com');
  });

  it('drops non-HTTP links from tool output', async () => {
    const preview = {
      links: [
        { url: 'intent://open-malicious-app', title: 'Unsafe' },
        { url: 'https://safe.example/path).', title: 'Safe' },
      ],
      totalResults: 2,
    };

    const { getByText, queryByText } = await render(<SearchContent preview={preview} />);

    expect(queryByText('intent://open-malicious-app')).toBeNull();
    await fireEvent.press(getByText('safe.example'));
    expect(mockOpenLink).toHaveBeenCalledWith('https://safe.example/path');
  });

  it('handles link-open failures', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('open failed'));
    const { getByText } = await render(
      <SearchContent
        preview={{ links: [{ url: 'https://one.com', title: 'One' }], totalResults: 1 }}
      />
    );

    await fireEvent.press(getByText('one.com'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Linking.openURL).toHaveBeenCalledWith('https://one.com');
  });
});

describe('CodeContent', () => {
  const createCodePreview = (overrides: Record<string, unknown> = {}) => ({
    ...overrides,
  });

  const createCodeArgs = (overrides: Record<string, unknown> = {}) => ({
    ...overrides,
  });

  it('renders code with language, output, errors, and raw fallback', async () => {
    const codeArgs = createCodeArgs({ code: 'print("hello")', language: 'python' });
    const { getByText, rerender } = await render(
      <CodeContent codeArgs={codeArgs} codePreview={createCodePreview()} />
    );
    expect(getByText('print("hello")')).toBeTruthy();
    expect(getByText('Python code')).toBeTruthy();

    await rerender(
      <CodeContent codeArgs={createCodeArgs()} codePreview={createCodePreview({ output: 'Hello, World!' })} />
    );
    expect(getByText('Hello, World!')).toBeTruthy();

    await rerender(
      <CodeContent
        codeArgs={createCodeArgs()}
        codePreview={createCodePreview({ errors: 'Error: something failed' })}
      />
    );
    expect(getByText('Error: something failed')).toBeTruthy();

    await rerender(
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

  it('renders resultPreview when present', async () => {
    const event = createEvent({ resultPreview: 'Preview result' });
    const { getByText } = await render(<GenericContent event={event} />);
    expect(getByText('Preview result')).toBeTruthy();
  });

  it('renders arguments when no resultPreview and args.ok', async () => {
    const event = createEvent({ arguments: { foo: 'bar' } });
    const { getByText } = await render(<GenericContent event={event} />);
    expect(getByText('Arguments')).toBeTruthy();
  });

  it('returns null when no resultPreview and args not ok', async () => {
    const event = createEvent({ resultPreview: undefined, arguments: null });
    const { toJSON } = await render(<GenericContent event={event} />);
    expect(toJSON()).toBeNull();
  });
});
