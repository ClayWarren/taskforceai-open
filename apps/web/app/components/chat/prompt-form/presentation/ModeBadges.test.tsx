import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../../../../tests/setup/dom';
import { ModeBadges } from './ModeBadges';

describe('ModeBadges', () => {
  it('returns null when no active badges', () => {
    const badges = [{ id: '1', label: 'Test', icon: '🚀', enabled: false, onClick: vi.fn() }];
    const { container } = render(<ModeBadges badges={badges} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders active badges', () => {
    const onClick = vi.fn();
    const badges = [{ id: '1', label: 'Autonomous', icon: '🤖', enabled: true, onClick }];
    render(<ModeBadges badges={badges} />);
    expect(screen.getByText('Autonomous')).toBeTruthy();
    expect(screen.getByText('🤖')).toBeTruthy();
  });

  it('renders multiple active badges', () => {
    const badges = [
      { id: '1', label: 'Autonomous', icon: '🤖', enabled: true, onClick: vi.fn() },
      { id: '2', label: 'Web Search', icon: '🔍', enabled: true, onClick: vi.fn() },
    ];
    render(<ModeBadges badges={badges} />);
    expect(screen.getByText('Autonomous')).toBeTruthy();
    expect(screen.getByText('Web Search')).toBeTruthy();
  });

  it('calls onClick when badge is clicked', () => {
    const onClick = vi.fn();
    const badges = [{ id: '1', label: 'Test', icon: '🚀', enabled: true, onClick }];
    render(<ModeBadges badges={badges} />);
    screen.getByText('Test').click();
    expect(onClick).toHaveBeenCalled();
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    const badges = [
      { id: '1', label: 'Test', icon: '🚀', enabled: true, onClick: vi.fn(), onDismiss },
    ];
    render(<ModeBadges badges={badges} />);
    const dismissButton = screen.getByLabelText(/disable test/i);
    expect(dismissButton).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const badges = [{ id: '1', label: 'Test', icon: '🚀', enabled: true, onClick, onDismiss }];
    render(<ModeBadges badges={badges} />);
    screen.getByLabelText(/disable test/i).click();
    expect(onDismiss).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not nest the dismiss control inside the badge button', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const badges = [{ id: '1', label: 'Test', icon: '🚀', enabled: true, onClick, onDismiss }];
    render(<ModeBadges badges={badges} />);
    const dismissButton = screen.getByRole('button', { name: /disable test/i });
    expect(dismissButton.parentElement?.closest('button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
