import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import { MessageActionBar, UserMessageActionBar } from './MessageActionBar';

afterEach(() => cleanup());

const setup = () => {
  const actions = {
    onCopy: vi.fn(),
    onSpeakToggle: vi.fn(),
    onShare: vi.fn(),
    onOpenSources: vi.fn(),
    onRate: vi.fn(),
  };
  const props: ComponentProps<typeof MessageActionBar> = {
    ...actions,
    copied: false,
    isSpeaking: false,
    listenDisabled: false,
    hasSources: false,
    sourceCount: 0,
    rating: 0,
  };
  return {
    actions,
    view: (overrides: Partial<typeof props> = {}) => <MessageActionBar {...props} {...overrides} />,
  };
};

describe('MessageActionBar', () => {
  it('renders both user copy layouts and invokes the handler', () => {
    const onCopy = vi.fn();
    const onRestore = vi.fn();
    const { rerender } = render(
      <UserMessageActionBar copied={false} onCopy={onCopy} onRestore={onRestore} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore to before this message' }));
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Restore')).toBeTruthy();
    expect(onRestore).toHaveBeenCalledTimes(1);

    rerender(<UserMessageActionBar copied onCopy={onCopy} onRestore={onRestore} />);
    expect(screen.getByText('Copied')).toBeTruthy();

    rerender(<UserMessageActionBar copied compact onCopy={onCopy} onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copied message' }));
    expect(screen.queryByText('Copied')).toBeNull();
    expect(onCopy).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Restore to before this message' }));
    expect(onRestore).toHaveBeenCalledTimes(2);
  });

  it('handles compact copy, feedback, and timestamp disclosure', () => {
    const { actions, view } = setup();
    const { rerender } = render(view({ compact: true, timestampLabel: '10:42 AM' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rate positive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rate negative' }));

    const more = screen.getByRole('button', { name: 'More options' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByRole('menu').textContent).toBe('10:42 AM');
    fireEvent.click(more);
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(view({ compact: true, copied: true, rating: 1 }));
    expect(screen.getByRole('button', { name: 'Copied response' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rated positive' })).toBeTruthy();
    expect(actions.onCopy).toHaveBeenCalledTimes(1);
    expect(actions.onRate).toHaveBeenNthCalledWith(1, 1);
    expect(actions.onRate).toHaveBeenNthCalledWith(2, -1);
  });

  it('renders and handles every full assistant action and active state', () => {
    const { actions, view } = setup();
    const { rerender } = render(
      view({
        canShare: true,
        hasSources: true,
        sourceCount: 1,
        rating: -1,
        timestampLabel: 'Yesterday',
      })
    );

    fireEvent.click(screen.getByTitle('Copy response'));
    fireEvent.click(screen.getByTitle('Listen to response'));
    fireEvent.click(screen.getByTitle('Share conversation'));
    fireEvent.click(screen.getByTitle('View sources'));
    fireEvent.click(screen.getByRole('button', { name: 'Rate positive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rated negative' }));
    expect(screen.getByText('1 source')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();

    rerender(
      view({
        copied: true,
        isSpeaking: true,
        listenDisabled: true,
        canShare: true,
        hasSources: true,
        sourceCount: 2,
        rating: 1,
      })
    );
    expect(screen.getByText('Copied')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('2 sources')).toBeTruthy();
    expect(screen.getByTitle('Stop listening').hasAttribute('disabled')).toBe(true);

    expect(actions.onCopy).toHaveBeenCalledTimes(1);
    expect(actions.onSpeakToggle).toHaveBeenCalledTimes(1);
    expect(actions.onShare).toHaveBeenCalledTimes(1);
    expect(actions.onOpenSources).toHaveBeenCalledTimes(1);
    expect(actions.onRate).toHaveBeenNthCalledWith(1, 1);
    expect(actions.onRate).toHaveBeenNthCalledWith(2, -1);
  });
});
