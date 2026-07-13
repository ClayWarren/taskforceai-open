import { render } from '@testing-library/react-native';

import { ToolUsageList } from '../../components/ToolUsageList';
import type { ToolUsageEvent } from '../../types';

jest.mock('../../components/ToolUsageList.styles', () => ({
  styles: {
    container: { flex: 1 },
    embeddedContainer: { padding: 8 },
    defaultContainer: { padding: 16 },
    heading: { fontSize: 16 },
    cardStack: { gap: 8 },
    card: { borderRadius: 8 },
    embeddedCard: { margin: 4 },
    cardHeader: { flexDirection: 'row' },
    toolTitle: { fontWeight: 'bold' },
    statusPill: { padding: 4 },
    statusText: { fontSize: 12 },
    metaRow: { flexDirection: 'row' },
    metaText: { fontSize: 12 },
    errorText: { color: 'red' },
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

jest.mock('../../components/ToolUsageList.content', () => ({
  SearchContent: ({ preview }: { preview: { links: Array<{ url: string }> } }) => {
    const React = require('react');
    const { Text, View } = require('react-native');
    return React.createElement(View, { testID: 'search-content' },
      React.createElement(Text, null, `Search results: ${preview.links.length}`)
    );
  },
  CodeContent: ({ codeArgs }: { codeArgs: { code?: string } }) => {
    const React = require('react');
    const { Text, View } = require('react-native');
    return React.createElement(View, { testID: 'code-content' },
      React.createElement(Text, null, codeArgs.code || 'No code')
    );
  },
  GenericContent: ({ event }: { event: { resultPreview?: string } }) => {
    const React = require('react');
    const { Text, View } = require('react-native');
    if (event.resultPreview) {
      return React.createElement(View, { testID: 'generic-content' },
        React.createElement(Text, null, event.resultPreview)
      );
    }
    return null;
  },
}));

const createToolEvent = (overrides: Partial<ToolUsageEvent> = {}): ToolUsageEvent => ({
  agentLabel: 'Agent',
  toolName: 'test_tool',
  arguments: {},
  success: true,
  durationMs: 1000,
  timestamp: Date.now(),
  ...overrides,
});

describe('ToolUsageList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for empty array', async () => {
    const { toJSON } = await render(<ToolUsageList toolEvents={[]} />);
    expect(toJSON()).toBeNull();
  });

  it('renders default heading and hides it for embedded variant', async () => {
    const events = [
      createToolEvent({ toolName: 'tool1', success: true }),
      createToolEvent({ toolName: 'tool2', success: true }),
      createToolEvent({ toolName: 'tool3', success: true }),
    ];
    const { getByText, queryByText, rerender } = await render(<ToolUsageList toolEvents={events} />);
    expect(getByText(/Tool Usage \(3\)/)).toBeTruthy();

    await rerender(<ToolUsageList toolEvents={events} variant="embedded" />);
    expect(queryByText(/Tool Usage/)).toBeNull();
  });

  it('displays non-search tool metadata and errors', async () => {
    const events = [
      createToolEvent({
        agentLabel: 'Custom Agent',
        durationMs: 5000,
        error: 'Something went wrong',
        toolName: 'custom_tool',
        success: false,
      }),
    ];
    const { getByText } = await render(<ToolUsageList toolEvents={events} />);
    expect(getByText(/Called/)).toBeTruthy();
    expect(getByText('Custom Agent')).toBeTruthy();
    expect(getByText('5.0 s')).toBeTruthy();
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('renders specialized content for search, code, and generic events', async () => {
    const { getByTestId, getByText, rerender } = await render(
      <ToolUsageList
        toolEvents={[
          createToolEvent({
            toolName: 'search_web',
            arguments: { query: 'test query' },
            success: true,
          }),
        ]}
      />
    );
    expect(getByText(/Searched for/)).toBeTruthy();
    expect(getByTestId('search-content')).toBeTruthy();

    await rerender(
      <ToolUsageList
        toolEvents={[
          createToolEvent({
            toolName: 'execute_code',
            arguments: { code: 'print(1)' },
            success: true,
          }),
        ]}
      />
    );
    expect(getByTestId('code-content')).toBeTruthy();

    await rerender(
      <ToolUsageList
        toolEvents={[
          createToolEvent({
            toolName: 'other_tool',
            resultPreview: 'result text',
            success: true,
          }),
        ]}
      />
    );
    expect(getByTestId('generic-content')).toBeTruthy();
  });
});
