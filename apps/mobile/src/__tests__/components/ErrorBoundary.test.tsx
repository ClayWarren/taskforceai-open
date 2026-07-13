import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockAsyncStorageClear = jest.fn().mockResolvedValue(undefined);
const mockResetDatabase = jest.fn().mockResolvedValue(undefined);
const mockUpdatesReloadAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    clear: mockAsyncStorageClear,
  },
}));

jest.mock('../../storage/database-manager', () => ({
  dbManager: { resetDatabase: mockResetDatabase },
}));

jest.mock('expo-updates', () => ({
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  reloadAsync: mockUpdatesReloadAsync,
}));

const { ErrorBoundary } = require('../../components/ErrorBoundary');

const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <Text>Normal content</Text>;
};

describe('ErrorBoundary', () => {
  const originalDev = global.__DEV__;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.__DEV__ = originalDev;
  });

  it('renders children when no error', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <Text>Child content</Text>
        </ErrorBoundary>
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Child content')).toBe(true);
  });

  it('renders custom fallback when provided', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary fallback={<Text>Custom fallback</Text>}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Custom fallback')).toBe(true);
  });

  it('renders default error UI when no fallback', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Something went wrong')).toBe(true);
  });

  it('shows error details in dev mode', () => {
    global.__DEV__ = true;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Error Details (Dev Only):')).toBe(true);
  });

  it('hides error details in production', () => {
    global.__DEV__ = false;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Error Details (Dev Only):')).toBe(false);
  });

  it('resets error state on Try Again', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    let shouldThrow = true;

    const ThrowingComponent = () => {
      if (shouldThrow) {
        throw new Error('Test error');
      }
      return <Text>Recovered</Text>;
    };

    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      );
    });

    let texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Something went wrong')).toBe(true);

    shouldThrow = false;

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const tryAgainButton = buttons.find(b =>
      b.findByType(Text).props.children === 'Try Again'
    );

    act(() => {
      tryAgainButton!.props.onPress();
    });

    texts = renderer!.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === 'Recovered')).toBe(true);
  });

  it('hard reset clears storage and resets the managed database before reloading', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find(button => button.text === 'Reset & Restart');
      confirmButton?.onPress?.();
    });

    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const hardResetButton = buttons.find(b =>
      b.findByType(Text).props.children === 'Reset App Data & Restart'
    );

    act(() => {
      hardResetButton!.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockAsyncStorageClear).toHaveBeenCalledTimes(1);
    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
    expect(mockUpdatesReloadAsync).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });

  it('reports hard reset failures', async () => {
    mockAsyncStorageClear.mockRejectedValueOnce(new Error('storage unavailable'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Reset & Restart')?.onPress?.();
    });
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    });
    const hardResetButton = renderer!.root
      .findAllByType(TouchableOpacity)
      .find((button) => button.findByType(Text).props.children === 'Reset App Data & Restart');

    act(() => hardResetButton!.props.onPress());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(alertSpy).toHaveBeenCalledWith(
      'Reset Failed',
      'Please try again or reinstall the app.'
    );
    alertSpy.mockRestore();
  });
});
