import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { LocalErrorBoundary } from '../../components/LocalErrorBoundary';
import { MessageBubbleContent } from '../../components/MessageBubble/MessageBubbleContent';
import { MathMessageContent } from '../../components/math/MathMessageContent';
import { styles } from '../../components/ToolUsageList.styles';
import type { Message } from '../../types';

jest.mock('@taskforceai/presenters/utils/math', () => ({
  splitMarkdownAndLatex: () => [
    { type: 'markdown', raw: 'before' },
    { type: 'block-math', expression: 'x^2' },
    { type: 'inline-math', expression: 'y' },
  ],
}));

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

jest.mock('../../components/MarkdownView', () => ({
  MarkdownView: ({ content, isUser }: { content: string | null | undefined; isUser?: boolean }) => {
    const ReactMod = require('react');
    const { Text: TextComp } = require('react-native');
    return ReactMod.createElement(TextComp, { testID: isUser ? 'markdown-user' : 'markdown' }, content);
  },
}));

jest.mock('../../components/MessageBubble/MessageTimestamp', () => ({
  MessageTimestamp: ({ timestamp }: { timestamp: number }) => {
    const ReactMod = require('react');
    const { Text: TextComp } = require('react-native');
    return ReactMod.createElement(TextComp, { testID: 'message-timestamp' }, timestamp);
  },
}));

jest.mock('../../utils/nativewind', () => ({
  styled: (Component: React.ComponentType<any>) => Component,
}));

jest.mock('expo-glass-effect', () => ({
  GlassView: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactMod = require('react');
    const { View: ViewComp } = require('react-native');
    return ReactMod.createElement(ViewComp, { testID: 'glass-view', ...props }, children);
  },
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
  }),
}));

describe('presentational components', () => {
  it('exports the complete ToolUsageList style contract', () => {
    expect(styles.container).toBeDefined();
    expect(styles.card).toBeDefined();
    expect(styles.logText).toBeDefined();
  });

  it('renders and resets LocalErrorBoundary fallback state', async () => {
    const onRetry = jest.fn();
    const error = new Error('render failed');
    const derived = LocalErrorBoundary.getDerivedStateFromError(error);

    expect(derived).toEqual({ hasError: true, error });

    const boundary = await render(
      <LocalErrorBoundary fallbackMessage="Could not render" onRetry={onRetry}>
        <Text>Child</Text>
      </LocalErrorBoundary>
    );
    expect(boundary.getByText('Child')).toBeTruthy();

    const ThrowingChild = () => {
      throw error;
    };
    await boundary.rerender(
      <LocalErrorBoundary fallbackMessage="Could not render" onRetry={onRetry}>
        <ThrowingChild />
      </LocalErrorBoundary>
    );

    expect(boundary.getByText('Could not render')).toBeTruthy();
    await fireEvent.press(boundary.getByText('Retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders MathMessageContent markdown and latex branches', async () => {
    const disabled = await render(<MathMessageContent content="plain" isUser={true} />);
    expect(disabled.getByTestId('markdown-user').props.children).toBe('plain');

    const enabled = await render(<MathMessageContent content="latex" enableLatexRendering={true} />);
    expect(enabled.getByText('before')).toBeTruthy();
    expect(enabled.getByText('x^2')).toBeTruthy();
    expect(enabled.getByText('y')).toBeTruthy();
  });

  it('renders MessageBubbleContent pressable variants', async () => {
    const onCopyPress = jest.fn();
    const message: Message = {
      id: 'message-1',
      role: 'assistant',
      content: 'Assistant reply',
      createdAt: 123,
      updatedAt: 456,
    };

    const plain = await render(
      <MessageBubbleContent
        message={message}
        isUser={false}
        useGlass={false}
        onCopyPress={onCopyPress}
      />
    );
    expect(plain.getByText('Assistant reply')).toBeTruthy();
    expect(plain.getByTestId('message-timestamp')).toBeTruthy();
    await fireEvent(plain.getByText('Assistant reply'), 'longPress');
    expect(onCopyPress).toHaveBeenCalledTimes(1);
    await fireEvent(plain.getByText('Assistant reply'), 'accessibilityAction', {
      nativeEvent: { actionName: 'copy' },
    });
    expect(onCopyPress).toHaveBeenCalledTimes(2);

    const glass = await render(
      <MessageBubbleContent
        message={{ ...message, role: 'user' }}
        isUser={true}
        useGlass={true}
        onCopyPress={onCopyPress}
      />
    );
    expect(glass.getByTestId('glass-view')).toBeTruthy();
  });

  it('does not render empty message bubble content', async () => {
    const empty = await render(
      <MessageBubbleContent
        message={null}
        isUser={false}
        useGlass={false}
        onCopyPress={jest.fn()}
      />
    );

    expect(empty.toJSON()).toBeNull();
  });
});
