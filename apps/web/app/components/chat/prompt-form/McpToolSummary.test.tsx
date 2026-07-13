import '../../../../../../tests/setup/dom';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { McpToolSummary } from './McpToolSummary';

describe('McpToolSummary', () => {
  it('renders at most six tool shortcuts and inserts the selected tool', () => {
    const onInsertTool = vi.fn();
    const items = Array.from({ length: 7 }, (_, index) => ({
      serverName: 'server',
      toolName: `tool-${index + 1}`,
    }));

    render(
      <McpToolSummary
        summary="7 tools enabled"
        items={items as never}
        onInsertTool={onInsertTool}
      />
    );

    expect(screen.getByText('7 tools enabled')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'server/tool-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'server/tool-7' })).toBeNull();

    screen.getByRole('button', { name: 'server/tool-3' }).click();
    expect(onInsertTool).toHaveBeenCalledWith('server', 'tool-3');
  });

  it('renders only the summary when no tools are listed', () => {
    render(<McpToolSummary summary="No tools enabled" items={[]} onInsertTool={vi.fn()} />);

    expect(screen.getByText('No tools enabled')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when no summary is available', () => {
    const { container } = render(
      <McpToolSummary summary={null} items={[]} onInsertTool={vi.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });
});
