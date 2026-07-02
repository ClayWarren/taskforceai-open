import '@testing-library/jest-dom';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import {
  ConversationListSkeleton,
  MessageSkeleton,
  Skeleton,
  StreamingMessageSkeleton,
} from './SkeletonScreen';

describe('Skeleton components', () => {
  it('renders base skeleton with provided dimensions and classes', () => {
    const { container } = render(<Skeleton width="50%" height="10px" className="custom" />);

    const element = container.firstChild;
    if (!(element instanceof HTMLElement)) {
      throw new Error('Skeleton element not found');
    }
    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element.className).toContain('custom');
    expect(element.style.width).toBe('50%');
    expect(element.style.height).toBe('10px');
  });

  it('renders conversation list skeleton with loading message', () => {
    render(<ConversationListSkeleton />);
    expect(
      within(document.body).getByRole('status', { name: 'Loading conversations' })
    ).toBeInTheDocument();
    expect(within(document.body).getByText('Loading conversations...')).toBeInTheDocument();
  });

  it('renders message skeleton with appropriate aria label', () => {
    render(<MessageSkeleton />);
    expect(
      within(document.body).getByRole('status', { name: 'Loading message' })
    ).toBeInTheDocument();
  });

  it('renders streaming message skeleton with animation dots', () => {
    render(<StreamingMessageSkeleton />);
    expect(
      within(document.body).getByRole('status', { name: 'Generating response' })
    ).toBeInTheDocument();
    expect(within(document.body).getByText('AI is thinking...')).toBeInTheDocument();
  });
});
