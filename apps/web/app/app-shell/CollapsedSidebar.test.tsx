import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import '../../../../tests/setup/dom';

import { CollapsedSidebar } from './CollapsedSidebar';

describe('CollapsedSidebar', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    isSidebarOpen: false,
    isAuthenticated: true,
    shouldShowNewChatShortcut: true,
    onLogoClick: mock(),
    onNewChat: mock(),
    onSearchClick: mock(),
    onOpenSidebar: mock(),
    onOpenProfile: mock(),
  };

  it('renders correctly', () => {
    render(<CollapsedSidebar {...defaultProps} />);
    expect(screen.getByLabelText('Quick navigation')).toBeTruthy();
    expect(screen.getByLabelText('Go to home')).toBeTruthy();
    expect(screen.getByLabelText('Start new chat')).toBeTruthy();
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.getByLabelText('Open sidebar')).toBeTruthy();
    expect(screen.getByLabelText('Open profile')).toBeTruthy();
  });

  it('handles clicks', () => {
    render(<CollapsedSidebar {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Go to home'));
    expect(defaultProps.onLogoClick).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Start new chat'));
    expect(defaultProps.onNewChat).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Search'));
    expect(defaultProps.onSearchClick).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Open sidebar'));
    expect(defaultProps.onOpenSidebar).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Open profile'));
    expect(defaultProps.onOpenProfile).toHaveBeenCalled();
  });

  it('shows terminal action when provided', () => {
    const onShowTerminal = mock();
    render(<CollapsedSidebar {...defaultProps} onShowTerminal={onShowTerminal} />);

    fireEvent.click(screen.getByLabelText('Toggle terminal'));
    expect(onShowTerminal).toHaveBeenCalled();
  });

  it('shows file tree action when provided', () => {
    const onFileTreeClick = mock();
    render(<CollapsedSidebar {...defaultProps} onFileTreeClick={onFileTreeClick} />);

    fireEvent.click(screen.getByLabelText('Toggle files'));
    expect(onFileTreeClick).toHaveBeenCalled();
  });

  it('shows update action when provided', () => {
    const onCheckForUpdates = mock();
    render(<CollapsedSidebar {...defaultProps} onCheckForUpdates={onCheckForUpdates} />);

    fireEvent.click(screen.getByLabelText('Check for updates'));
    expect(onCheckForUpdates).toHaveBeenCalled();
  });

  it('hides new chat shortcut when configured', () => {
    render(<CollapsedSidebar {...defaultProps} shouldShowNewChatShortcut={false} />);
    expect(screen.queryByLabelText('Start new chat')).toBeNull();
  });

  it('disables profile button when unauthenticated', () => {
    render(<CollapsedSidebar {...defaultProps} isAuthenticated={false} />);
    const profileButton = screen.getByLabelText('Open profile');
    expect(profileButton).toBeDisabled();
    expect(profileButton.className).toContain('cursor-not-allowed');
  });

  it('hides when sidebar is open', () => {
    render(<CollapsedSidebar {...defaultProps} isSidebarOpen={true} />);
    const nav = screen.getByLabelText('Quick navigation');
    expect(nav.className).toContain('opacity-0');
    expect(nav.className).toContain('pointer-events-none');
  });
});
