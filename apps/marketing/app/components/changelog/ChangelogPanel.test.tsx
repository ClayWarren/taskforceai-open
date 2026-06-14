import '@testing-library/jest-dom';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import ChangelogPanel from './ChangelogPanel';

const formatDate = (value: string): string => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
};

describe('ChangelogPanel', () => {
  const renderPanel = (props: React.ComponentProps<typeof ChangelogPanel> = {}) => {
    render(<ChangelogPanel {...props} />);
    return within(document.body);
  };

  it('renders fallback copy when no content or lastUpdated is provided', () => {
    const view = renderPanel();

    expect(view.getByText('Product updates')).toBeInTheDocument();
    expect(view.getByText('TaskForceAI Changelog')).toBeInTheDocument();
    expect(view.getByText(/Fresh updates arrive weekly/i)).toBeInTheDocument();
    expect(view.getByText(/Updates in progress/i)).toBeInTheDocument();
  });

  it('renders formatted date, content, and handles the back-to-chat action', () => {
    const onStartChat = vi.fn();
    const content = '## Shipping notes\nWe shipped a new release.';
    const lastUpdated = '2025-02-14T12:00:00Z';

    const view = renderPanel({ content, lastUpdated, onStartChat });
    const expectedDate = formatDate(lastUpdated);

    expect(view.getByText(`Last updated ${expectedDate}`)).toBeInTheDocument();
    expect(view.getByText(/Shipping notes/i)).toBeInTheDocument();

    const button = view.getByRole('button', { name: 'Back to chat' });
    fireEvent.click(button);
    expect(onStartChat).toHaveBeenCalledTimes(1);
  });
});
