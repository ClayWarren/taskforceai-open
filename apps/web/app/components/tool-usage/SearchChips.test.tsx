import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';
import { SearchChips } from './SearchChips';

describe('SearchChips', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps: React.ComponentProps<typeof SearchChips> = {
    eventKey: 'test-event',
    links: [
      { url: 'https://example.com/page1', title: 'Example 1', snippet: '' },
      { url: 'https://google.com/search', title: 'Google', snippet: '' },
    ],
    sources: [],
    seeAllCount: null,
    interactive: true,
  };

  const renderChips = (overrides: Partial<typeof defaultProps> = {}) =>
    render(<SearchChips {...defaultProps} {...overrides} />);

  test('renders nothing when no links provided', () => {
    const { container } = renderChips({ links: [] });
    expect(container.firstChild).toBeNull();
  });

  test('renders chips for links', () => {
    renderChips();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('google.com')).toBeTruthy();
  });

  test('renders links as anchors when interactive', () => {
    renderChips({ interactive: true });
    const link = screen.getByText('example.com').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://example.com/page1');
  });

  test('renders links as spans when not interactive', () => {
    renderChips({ interactive: false });
    const span = screen.getByText('example.com');
    expect(span.tagName.toLowerCase()).toBe('span');
    expect(span.closest('a')).toBeNull();
  });

  test('renders "See all" button when count is provided and interactive', () => {
    const onShowSources = vi.fn();
    const sources = [{ url: 's1', title: 's1' }];
    renderChips({
      seeAllCount: 5,
      interactive: true,
      onShowSources,
      sources,
    });

    const button = screen.getByText('See all (5)');
    expect(button.tagName.toLowerCase()).toBe('button');

    fireEvent.click(button);
    expect(onShowSources).toHaveBeenCalledWith(sources);
  });

  test('renders "See all" as span when not interactive', () => {
    renderChips({ seeAllCount: 5, interactive: false });

    const span = screen.getByText('See all (5)');
    expect(span.tagName.toLowerCase()).toBe('span');
  });

  test('renders disabled see-all chip without a sources callback', () => {
    renderChips({
      links: [{ url: 'javascript:alert(1)', title: 'Unsafe', snippet: '' }],
      sources: [{ url: 'https://safe.example', title: 'Safe' }],
      seeAllCount: 2,
      interactive: true,
      onShowSources: undefined,
    });

    expect(screen.getByText('See all (2)').tagName.toLowerCase()).toBe('span');
  });

  test('skips links without a displayable domain', () => {
    const { container } = renderChips({
      links: [{ url: '', title: 'Empty', snippet: '' }],
      seeAllCount: null,
    });

    expect(container.querySelector('.tool-usage__search-chip')).toBeNull();
  });

  test('renders disabled chip when interactive URL is unsafe', () => {
    renderChips({
      links: [{ url: 'ftp://files.example.com/report', title: 'FTP', snippet: '' }],
      interactive: true,
    });

    const chip = screen.getByText('files.example.com');
    expect(chip.tagName.toLowerCase()).toBe('span');
    expect(chip.closest('a')).toBeNull();
  });

  test('limits rendering to 4 chips', () => {
    const links = Array.from({ length: 10 }, (_, i) => ({
      url: `https://site${i}.com`,
      title: `Site ${i}`,
      snippet: '',
    }));

    renderChips({ links });

    // Should see first 4
    expect(screen.getByText('site0.com')).toBeTruthy();
    expect(screen.getByText('site3.com')).toBeTruthy();
    // Should not see 5th
    expect(screen.queryByText('site4.com')).toBeNull();
  });
});
