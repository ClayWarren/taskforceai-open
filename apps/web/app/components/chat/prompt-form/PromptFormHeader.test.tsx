import '../../../../../../tests/setup/dom';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { PromptFormHeader } from './PromptFormHeader';

describe('PromptFormHeader', () => {
  it('renders the login note, active mode badges, and MCP tool shortcuts', () => {
    const onInsertMcpTool = vi.fn();

    render(
      <PromptFormHeader
        loginPromptText="Sign in to sync prompts"
        shouldShowLoginNote
        modeBadges={[
          {
            id: 'autonomous',
            label: 'Autonomous',
            icon: 'A',
            enabled: true,
            onClick: vi.fn(),
          },
        ]}
        mcpToolSummary="2 local tools enabled"
        mcpToolItems={[
          {
            serverName: 'docs',
            toolName: 'lookup',
            title: 'Lookup',
            description: 'Search docs',
          } as never,
        ]}
        onInsertMcpTool={onInsertMcpTool}
      />
    );

    expect(screen.getByText('Sign in to sync prompts')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Autonomous')).toBeTruthy();
    expect(screen.getByText('2 local tools enabled')).toBeTruthy();

    screen.getByRole('button', { name: 'docs/lookup' }).click();
    expect(onInsertMcpTool).toHaveBeenCalledWith('docs', 'lookup');
  });

  it('omits optional prompt header sections when nothing is active', () => {
    const { container } = render(
      <PromptFormHeader
        loginPromptText="Sign in"
        shouldShowLoginNote={false}
        modeBadges={[]}
        mcpToolSummary={null}
        mcpToolItems={[]}
        onInsertMcpTool={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
