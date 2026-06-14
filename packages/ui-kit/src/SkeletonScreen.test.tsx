import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../tests/setup/dom';

import {
  ConversationListSkeleton,
  MessageSkeleton,
  Skeleton,
  StreamingMessageSkeleton,
} from './SkeletonScreen';

describe('SkeletonScreen', () => {
  it('renders the base skeleton with caller-provided dimensions and class names', () => {
    const { container } = render(<Skeleton width="50%" height="10px" className="custom" />);
    const element = container.firstElementChild;

    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element).toHaveClass('custom');
    expect((element as HTMLElement).style.width).toBe('50%');
    expect((element as HTMLElement).style.height).toBe('10px');
  });

  it('renders accessible loading states for conversation and message placeholders', () => {
    render(
      <>
        <ConversationListSkeleton />
        <MessageSkeleton />
      </>
    );

    expect(screen.getByRole('status', { name: 'Loading conversations' })).toBeInTheDocument();
    expect(screen.getByText('Loading conversations...')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading message' })).toBeInTheDocument();
  });

  it('renders the streaming response placeholder', () => {
    render(<StreamingMessageSkeleton />);

    expect(screen.getByRole('status', { name: 'Generating response' })).toBeInTheDocument();
    expect(screen.getByText('AI is thinking...')).toBeInTheDocument();
  });
});
