import '@testing-library/jest-dom';
import { render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { logger } from '../../lib/logger';

let SourcesList: typeof import('./SourcesList').default;

const makeSource = (index: number) => ({
  url: `https://example${index}.com/article`,
  title: `Example ${index}`,
  snippet: `Snippet ${index}`,
});

describe('SourcesList', () => {
  const renderSources = (sources: Array<{ url: string; title?: string; snippet?: string }>) => {
    render(<SourcesList sources={sources} />);
    return within(document.body);
  };

  beforeEach(async () => {
    ({ default: SourcesList } = await import('./SourcesList'));
    vi.clearAllMocks();
  });

  it('returns null when no sources provided', () => {
    const { container } = render(<SourcesList sources={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('limits the rendered sources and formats domains', () => {
    const sources = Array.from({ length: 7 }, (_, idx) => makeSource(idx));
    const view = renderSources(sources);
    const items = view.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent('example0.com');
  });

  it('renders optional snippets when provided', () => {
    const sources = [
      { url: 'https://docs.example.com/page', title: 'Docs', snippet: 'Documentation' },
    ];
    const view = renderSources(sources);
    expect(view.getByText('Documentation')).toBeInTheDocument();
  });

  it('filters unsafe URLs and logs diagnostics', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const view = renderSources([
      { url: 'javascript:alert(1)', title: 'Unsafe' },
      { url: 'https://safe.example.com/page', title: 'Safe' },
    ]);

    expect(view.queryByText('Unsafe')).toBeNull();
    expect(view.getByText('safe.example.com')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith('Dropped source with unsafe URL in SourcesList', {
      url: 'javascript:alert(1)',
      title: 'Unsafe',
    });
  });
});
