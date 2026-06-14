import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text } from 'react-native';

import { LocalErrorBoundary } from '../../components/LocalErrorBoundary';
import { MessageBubbleContent } from '../../components/MessageBubble/MessageBubbleContent';
import { MathMessageContent } from '../../components/math/MathMessageContent';
import { styles } from '../../components/ToolUsageList.styles';
import type { Message } from '../../types';

jest.mock('@taskforceai/shared/utils/math', () => ({
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

describe('presentational coverage helpers', () => {
  it('exports the complete ToolUsageList style contract', () => {
    expect(styles.container).toBeDefined();
    expect(styles.card).toBeDefined();
    expect(styles.logText).toBeDefined();
  });

  it('renders and resets LocalErrorBoundary fallback state', () => {
    const onRetry = jest.fn();
    const error = new Error('render failed');
    const derived = LocalErrorBoundary.getDerivedStateFromError(error);

    expect(derived).toEqual({ hasError: true, error });

    const boundary = render(
      <LocalErrorBoundary fallbackMessage="Could not render" onRetry={onRetry}>
        <Text>Child</Text>
      </LocalErrorBoundary>
    );
    expect(boundary.getByText('Child')).toBeTruthy();

    boundary.update(
      <LocalErrorBoundary fallbackMessage="Could not render" onRetry={onRetry}>
        <Text>Child</Text>
      </LocalErrorBoundary>
    );
    const instance = boundary.UNSAFE_getByType(LocalErrorBoundary).instance as LocalErrorBoundary;
    act(() => {
      instance.setState({ hasError: true, error });
    });

    expect(boundary.getByText('Could not render')).toBeTruthy();
    fireEvent.press(boundary.getByText('Retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders MathMessageContent markdown and latex branches', () => {
    const disabled = render(<MathMessageContent content="plain" isUser={true} />);
    expect(disabled.getByTestId('markdown-user').props.children).toBe('plain');

    const enabled = render(<MathMessageContent content="latex" enableLatexRendering={true} />);
    expect(enabled.getByText('before')).toBeTruthy();
    expect(enabled.getByText('x^2')).toBeTruthy();
    expect(enabled.getByText('y')).toBeTruthy();
  });

  it('renders MessageBubbleContent pressable variants', () => {
    const onCopyPress = jest.fn();
    const message: Message = {
      id: 'message-1',
      role: 'assistant',
      content: 'Assistant reply',
      createdAt: 123,
      updatedAt: 456,
    };

    const plain = render(
      <MessageBubbleContent
        message={message}
        isUser={false}
        useGlass={false}
        onCopyPress={onCopyPress}
      />
    );
    expect(plain.getByText('Assistant reply')).toBeTruthy();
    expect(plain.getByTestId('message-timestamp')).toBeTruthy();
    fireEvent(plain.UNSAFE_getByType(Pressable), 'longPress');
    expect(onCopyPress).toHaveBeenCalledTimes(1);

    const glass = render(
      <MessageBubbleContent
        message={{ ...message, role: 'user' }}
        isUser={true}
        useGlass={true}
        onCopyPress={onCopyPress}
      />
    );
    expect(glass.getByTestId('glass-view')).toBeTruthy();
  });
});
