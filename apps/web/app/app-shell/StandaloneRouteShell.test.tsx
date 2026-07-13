import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const navigate = vi.fn();
const openProfileModal = vi.fn();

vi.mock('../components/routing', () => ({
  useRouter: () => ({
    navigate,
  }),
}));

vi.mock('../components/shell/Sidebar', () => ({
  __esModule: true,
  default: (props: {
    isOpen: boolean;
    onClose: () => void;
    onNewChat: () => void;
    onConversationSelect: (_conversation: {
      id: number;
      user_input: string;
      timestamp: string;
      result: string;
      model: string;
    }) => void;
  }) => (
    <aside data-open={String(props.isOpen)} data-testid="sidebar">
      <button type="button" onClick={props.onClose}>
        Close sidebar
      </button>
      <button type="button" onClick={props.onNewChat}>
        New chat
      </button>
      <button
        type="button"
        onClick={() =>
          props.onConversationSelect({
            id: 1,
            user_input: 'Selected',
            timestamp: new Date(0).toISOString(),
            result: '',
            model: 'local-selected',
          })
        }
      >
        Select conversation
      </button>
    </aside>
  ),
}));

vi.mock('../lib/profile/ProfileModalContext', () => ({
  useProfileModal: () => ({
    open: openProfileModal,
  }),
}));

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}));

vi.mock('./CollapsedSidebar', () => ({
  CollapsedSidebar: (props: {
    isSidebarOpen: boolean;
    onNewChat: () => void;
    onOpenProfile: () => void;
    onOpenSidebar: () => void;
  }) => (
    <nav data-open={String(props.isSidebarOpen)} data-testid="collapsed-sidebar">
      <button type="button" onClick={props.onOpenSidebar}>
        Open collapsed sidebar
      </button>
      <button type="button" onClick={props.onNewChat}>
        Collapsed new chat
      </button>
      <button type="button" onClick={props.onOpenProfile}>
        Open profile
      </button>
    </nav>
  ),
}));

vi.mock('./icons', () => ({
  MobileHamburgerIcon: () => <span />,
}));

import { StandaloneRouteShell } from './StandaloneRouteShell';

describe('StandaloneRouteShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => cleanup());

  it('renders route content inside the shared sidebar frame', () => {
    const { container } = render(
      <StandaloneRouteShell>
        <div>Artifact library</div>
      </StandaloneRouteShell>
    );

    expect(screen.getByText('Artifact library')).toBeTruthy();
    expect(screen.getByTestId('sidebar').getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('collapsed-sidebar')).toBeTruthy();
    expect(container.querySelector('.main-content')?.className).toContain('md:pl-32');
  });

  it('opens the shared sidebar and reserves desktop sidebar space', () => {
    const { container } = render(
      <StandaloneRouteShell>
        <div>Artifact library</div>
      </StandaloneRouteShell>
    );

    fireEvent.click(screen.getByText('Open collapsed sidebar'));

    expect(screen.getByTestId('sidebar').getAttribute('data-open')).toBe('true');
    expect(container.querySelector('.main-content')?.className).toContain('md:pl-[20rem]');
  });

  it('routes new chat and selected conversations back through the home shell', () => {
    render(
      <StandaloneRouteShell>
        <div>Artifact library</div>
      </StandaloneRouteShell>
    );

    fireEvent.click(screen.getByText('New chat'));
    expect(navigate).toHaveBeenCalledWith({ to: '/' });

    fireEvent.click(screen.getByText('Select conversation'));
    expect(window.localStorage.getItem('activeConversationId')).toBe('local-selected');
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('opens the profile modal from the collapsed route shell', () => {
    render(
      <StandaloneRouteShell>
        <div>Artifact library</div>
      </StandaloneRouteShell>
    );

    fireEvent.click(screen.getByText('Open profile'));

    expect(openProfileModal).toHaveBeenCalledWith({ onOpen: expect.any(Function) });
  });
});
