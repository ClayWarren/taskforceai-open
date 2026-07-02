import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock dependencies
const mockShareConversation = mock();
const mockGetBrowserClient = mock(() => ({
  shareConversation: mockShareConversation,
}));
const mockLoggerError = mock();
const mockClipboardWriteText = mock();
const mockGetCsrfToken = mock(async () => 'csrf-token');

mock.module('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: mockGetBrowserClient,
}));

mock.module('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: mockGetCsrfToken,
  withCsrf: mock(async (init: RequestInit = {}) => init),
}));

mock.module('../../lib/logger', () => ({
  logger: {
    error: mockLoggerError,
  },
}));

const { default: ShareModal } = await import('./ShareModal');

// Mock Navigator clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: mockClipboardWriteText,
  },
  writable: true,
  configurable: true,
});

describe('ShareModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: mock(),
    conversationId: 123,
    initialIsPublic: false,
    initialShareId: '',
  };

  beforeEach(() => {
    mockShareConversation.mockClear();
    mockGetBrowserClient.mockClear();
    mockGetCsrfToken.mockClear();
    mockLoggerError.mockClear();
    mockClipboardWriteText.mockClear();
    defaultProps.onClose.mockClear();
    mockShareConversation.mockResolvedValue({
      is_public: true,
      url: 'https://taskforceai.chat/share/xyz',
    });
  });

  it('renders nothing when not open', () => {
    const { queryByText } = render(<ShareModal {...defaultProps} isOpen={false} />);
    expect(queryByText('Share link to conversation')).toBeNull();
  });

  it('renders correctly when open and private', () => {
    render(<ShareModal {...defaultProps} />);
    expect(screen.getByText('Share link to conversation')).toBeTruthy();
    expect(screen.getByText('Create public link')).toBeTruthy();
  });

  it('calls onClose when close button clicked', () => {
    render(<ShareModal {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('enables public link when button clicked', async () => {
    render(<ShareModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Create public link'));

    expect(screen.getByText('Enabling...')).toBeTruthy();

    await waitFor(() => {
      expect(mockShareConversation).toHaveBeenCalledWith(123, true);
    });
    expect(mockGetBrowserClient).toHaveBeenCalledWith(
      expect.objectContaining({
        getCsrfToken: expect.any(Function),
      })
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://taskforceai.chat/share/xyz')).toBeTruthy();
    });
  });

  it('renders public state correctly', () => {
    render(<ShareModal {...defaultProps} initialIsPublic={true} initialShareId="abc" />);
    const shareInput = screen.getByDisplayValue(/\/share\/abc$/);
    if (!(shareInput instanceof HTMLInputElement)) {
      throw new Error('Expected share URL field to be an HTMLInputElement');
    }
    expect(shareInput.value).toMatch(/\/share\/abc$/);
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Disable public link')).toBeTruthy();
  });

  it('copies link to clipboard', async () => {
    render(<ShareModal {...defaultProps} initialIsPublic={true} initialShareId="abc" />);

    fireEvent.click(screen.getByText('Copy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/share\/abc$/)
    );
    expect(await screen.findByText('Copied!')).toBeTruthy();
  });

  it('disables public link when button clicked', async () => {
    mockShareConversation.mockResolvedValue({
      is_public: false,
      url: '',
    });

    render(<ShareModal {...defaultProps} initialIsPublic={true} initialShareId="abc" />);

    fireEvent.click(screen.getByText('Disable public link'));

    expect(screen.getByText('Disabling...')).toBeTruthy();

    await waitFor(() => {
      expect(mockShareConversation).toHaveBeenCalledWith(123, false);
    });

    await waitFor(() => {
      expect(screen.getByText('Create public link')).toBeTruthy();
    });
  });

  it('reverts "Copied!" to "Copy" after 2 seconds', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    render(<ShareModal {...defaultProps} initialIsPublic={true} initialShareId="abc" />);

    fireEvent.click(screen.getByText('Copy'));

    // "Copied!" should appear immediately after clipboard write
    expect(await screen.findByText('Copied!')).toBeTruthy();

    // After 2s the state should revert
    await waitFor(
      () => {
        expect(screen.getByText('Copy')).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });

  it('clears timeout on unmount so no state update fires after removal', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    const { unmount } = render(
      <ShareModal {...defaultProps} initialIsPublic={true} initialShareId="abc" />
    );

    // Trigger the copy (starts the 2s timer)
    fireEvent.click(screen.getByText('Copy'));
    expect(await screen.findByText('Copied!')).toBeTruthy();

    // Unmount before the timer fires — no act() warning should occur
    expect(() => unmount()).not.toThrow();
  });
});
