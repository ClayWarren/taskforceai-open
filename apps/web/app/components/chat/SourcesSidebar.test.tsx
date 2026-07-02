import '@testing-library/jest-dom';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { logger } from '../../lib/logger';
import SourcesSidebar from './SourcesSidebar';

const sources = [
  {
    url: 'https://docs.example.com/guide',
    title: 'Integration Guide',
    snippet: 'How to connect the service.',
  },
  {
    url: 'https://www.taskforce.ai/blog',
    title: 'taskforce.ai',
  },
];

describe('SourcesSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <SourcesSidebar sources={sources} isOpen={false} onClose={vi.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders sanitized source links with count, domains, titles, and snippets', () => {
    render(<SourcesSidebar sources={sources} isOpen onClose={vi.fn()} />);

    const sidebar = screen.getByRole('complementary', { name: 'Sources (2)' });
    expect(within(sidebar).getByText('2')).toBeInTheDocument();

    const links = within(sidebar).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://docs.example.com/guide');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(sidebar).getByText('docs.example.com')).toBeInTheDocument();
    expect(within(sidebar).getByText('Integration Guide')).toBeInTheDocument();
    expect(within(sidebar).getByText('How to connect the service.')).toBeInTheDocument();
    expect(within(sidebar).getByText('taskforce.ai')).toBeInTheDocument();
  });

  it('filters unsafe URLs and shows the empty state when none remain', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    render(
      <SourcesSidebar
        sources={[{ url: 'javascript:alert(1)', title: 'Unsafe source' }]}
        isOpen
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('complementary', { name: 'Sources (0)' })).toBeInTheDocument();
    expect(screen.getByText('No valid sources available.')).toBeInTheDocument();
    expect(screen.queryByText('Unsafe source')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('Dropped source with unsafe URL in SourcesSidebar', {
      url: 'javascript:alert(1)',
      title: 'Unsafe source',
    });
  });

  it('closes from the close button, Escape key, and backdrop', () => {
    const onClose = vi.fn();
    const { rerender } = render(<SourcesSidebar sources={sources} isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close sources panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<SourcesSidebar sources={sources} isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<SourcesSidebar sources={sources} isOpen onClose={onClose} />);
    fireEvent.click(document.querySelector('.sources-sidebar-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
