import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

interface MockProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModalOpen?: () => void;
}

vi.mock('./ProfileModal', () => ({
  __esModule: true,
  default: ({ open, onOpenChange, onModalOpen }: MockProfileModalProps) => (
    <div data-testid="profile-modal" data-open={open ? 'true' : 'false'}>
      <button type="button" onClick={() => onOpenChange(false)}>
        modal-close
      </button>
      <button type="button" onClick={() => onOpenChange(true)}>
        modal-open-change
      </button>
      <button type="button" onClick={() => onModalOpen?.()}>
        modal-open-callback
      </button>
    </div>
  ),
}));

import {
  ProfileModalProvider,
  useOptionalProfileModal,
  useProfileModal,
} from './ProfileModalContext';

const Controls = ({ onOpenCallback }: { onOpenCallback?: () => void }) => {
  const modal = useProfileModal();
  const optionalModal = useOptionalProfileModal();

  return (
    <div>
      <button type="button" onClick={() => modal.open({ onOpen: onOpenCallback })}>
        open-with-callback
      </button>
      <button type="button" onClick={() => modal.open()}>
        open-without-callback
      </button>
      <button type="button" onClick={modal.close}>
        close-from-context
      </button>
      <span data-testid="optional-modal-state">{optionalModal ? 'present' : 'missing'}</span>
    </div>
  );
};

const HookGuardConsumer = () => {
  useProfileModal();
  return null;
};

const OptionalHookConsumer = () => {
  const modal = useOptionalProfileModal();
  return <div>{modal ? 'present' : 'missing'}</div>;
};

describe('ProfileModalContext', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens, closes, and resets onOpen callback after use', () => {
    const onOpenCallback = vi.fn();
    render(
      <ProfileModalProvider>
        <Controls onOpenCallback={onOpenCallback} />
      </ProfileModalProvider>
    );

    expect(screen.getByTestId('optional-modal-state').textContent).toBe('present');
    expect(screen.getByTestId('profile-modal')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'open-with-callback' }));
    expect(screen.getByTestId('profile-modal')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'modal-open-callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'modal-open-callback' }));
    expect(onOpenCallback).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'close-from-context' }));
    expect(screen.getByTestId('profile-modal')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'modal-open-callback' }));
    expect(onOpenCallback).toHaveBeenCalledTimes(1);
  });

  it('resets pending callback when modal reports closed via onOpenChange(false)', () => {
    const onOpenCallback = vi.fn();
    render(
      <ProfileModalProvider>
        <Controls onOpenCallback={onOpenCallback} />
      </ProfileModalProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'open-with-callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'modal-close' }));
    expect(screen.getByTestId('profile-modal')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'modal-open-callback' }));
    expect(onOpenCallback).not.toHaveBeenCalled();
  });

  it('guards callback failures during onModalOpen', () => {
    const onOpenCallback = vi.fn(() => {
      throw new Error('open callback failed');
    });
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = env['NODE_ENV'];
    env['NODE_ENV'] = 'production';

    try {
      render(
        <ProfileModalProvider>
          <Controls onOpenCallback={onOpenCallback} />
        </ProfileModalProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'open-with-callback' }));
      expect(() =>
        fireEvent.click(screen.getByRole('button', { name: 'modal-open-callback' }))
      ).not.toThrow();
      expect(onOpenCallback).toHaveBeenCalledTimes(1);
    } finally {
      env['NODE_ENV'] = previousNodeEnv;
    }
  });

  it('throws a guard error when useProfileModal is called outside provider', () => {
    expect(() => render(<HookGuardConsumer />)).toThrow(
      'useProfileModal must be used within a ProfileModalProvider'
    );
  });

  it('returns undefined from useOptionalProfileModal outside provider', () => {
    render(<OptionalHookConsumer />);
    expect(screen.getByText('missing')).toBeDefined();
  });
});
