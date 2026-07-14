import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../../../../tests/setup/dom';
import { PromptTemplateMenu, PromptTemplateMenuItems } from './PromptTemplateMenu';
import type { PromptTemplate } from './promptTemplates';

vi.mock('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

const reviewTemplate: PromptTemplate = {
  id: 'review-code',
  category: 'code',
  label: 'Review code',
  description: 'Find bugs and risky changes',
  prompt: 'Review this code.',
};

const researchTemplate: PromptTemplate = {
  id: 'earnings-summary',
  category: 'research',
  label: 'Earnings summary',
  description: 'Results, guidance, and surprises',
  prompt: 'Prepare an earnings summary.',
};

describe('PromptTemplateMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render a trigger when no prompt templates are available', () => {
    const { container } = render(
      <PromptTemplateMenu templates={[]} disabled={false} onInsertTemplate={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('groups templates by category and inserts the selected template', () => {
    const onInsertTemplate = vi.fn();

    render(
      <PromptTemplateMenuItems
        templates={[researchTemplate, reviewTemplate]}
        onInsertTemplate={onInsertTemplate}
      />
    );

    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /review code/i }));

    expect(onInsertTemplate).toHaveBeenCalledTimes(1);
    expect(onInsertTemplate).toHaveBeenCalledWith(reviewTemplate);
  });
});
