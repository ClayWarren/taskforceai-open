import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createMockMessage } from '#tests/fixtures/client-messages';

import '../../../../../tests/setup/dom';
import type { Message } from '../../lib/types';
import { ChatView } from './ChatView';

// Child component mocks
mock.module('../../components/chat/MessageBubble', () => ({
  default: ({
    message,
    isPrivateChat,
    executionPresentation,
  }: {
    message: Message;
    isPrivateChat?: boolean;
    executionPresentation?: 'standard' | 'code';
  }) => (
    <div
      data-private={String(isPrivateChat)}
      data-execution-presentation={executionPresentation}
      data-testid="message-bubble"
    >
      {message.content}
    </div>
  ),
}));
mock.module('../../components/chat/RateLimitError', () => ({
  default: ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
    <div data-testid="rate-limit-error">
      {message}
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));
mock.module('./MobileHero', () => ({
  MobileHero: () => <div data-testid="mobile-hero">Hero</div>,
}));

describe('ChatView', () => {
  const defaultProps = {
    messages: [],
    showMobileHero: false,
    showPromptLogo: false,
    promptVariant: 'centered' as const,
    isPromptDisabled: false,
    isAuthenticated: true,
    errorMessage: null,
    rateLimitResetTime: null,
    modelSelectorBootstrap: null,
    onHamburgerClick: mock(),
    onSignIn: mock(),
    onSignUp: mock(),
    onSendMessage: mock(),
    clearErrorMessage: mock(),
    ensureConversationId: mock(),
  };

  beforeEach(() => {
    defaultProps.clearErrorMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders messages', () => {
    const messages: Message[] = [
      createMockMessage({ id: '1', role: 'user', content: 'Hello' }),
      createMockMessage({ id: '2', role: 'assistant', content: 'Hi there' }),
    ];

    render(<ChatView {...defaultProps} messages={messages} />);

    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    const firstBubble = bubbles[0];
    const secondBubble = bubbles[1];
    if (!firstBubble || !secondBubble) {
      throw new Error('Expected two message bubbles');
    }
    expect(firstBubble.textContent).toBe('Hello');
    expect(secondBubble.textContent).toBe('Hi there');
  });

  it('passes private chat state to message bubbles', () => {
    const messages: Message[] = [
      createMockMessage({ id: 'private-1', role: 'assistant', content: 'Private answer' }),
    ];

    render(<ChatView {...defaultProps} messages={messages} isPrivateChat />);

    expect(screen.getByTestId('message-bubble').getAttribute('data-private')).toBe('true');
  });

  it('passes the Code execution presentation to message bubbles', () => {
    const messages: Message[] = [
      createMockMessage({ id: 'code-1', role: 'assistant', content: 'Code update' }),
    ];

    render(<ChatView {...defaultProps} messages={messages} executionPresentation="code" />);

    expect(screen.getByTestId('message-bubble').getAttribute('data-execution-presentation')).toBe(
      'code'
    );
  });

  it('renders mobile hero when enabled', () => {
    render(<ChatView {...defaultProps} showMobileHero={true} />);
    expect(screen.getByTestId('mobile-hero')).toBeTruthy();
    // Should apply hero class
    expect(document.querySelector('.chat-messages--hero')).toBeTruthy();
  });

  it('renders rate limit error', () => {
    render(<ChatView {...defaultProps} errorMessage="Rate limit exceeded" />);
    expect(screen.getByTestId('rate-limit-error')).toBeTruthy();
    expect(screen.getByText('Rate limit exceeded')).toBeTruthy();
  });

  it('renders generic error', () => {
    render(<ChatView {...defaultProps} errorMessage="Something went wrong" />);
    // Generic error markup check
    const errorDiv = document.querySelector('.error-message');
    expect(errorDiv).toBeTruthy();
    expect(errorDiv?.textContent).toContain('Something went wrong');
  });

  it('dismisses rate limit error', () => {
    render(<ChatView {...defaultProps} errorMessage="Rate limit exceeded" />);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(defaultProps.clearErrorMessage).toHaveBeenCalled();
  });

  it('dismisses generic error', () => {
    render(<ChatView {...defaultProps} errorMessage="Generic error" />);
    fireEvent.click(screen.getByLabelText('Dismiss error'));
    expect(defaultProps.clearErrorMessage).toHaveBeenCalled();
  });
});
