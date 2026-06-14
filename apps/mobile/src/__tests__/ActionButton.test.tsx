import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ActionButton } from '../components/ActionButton';
import { ThemeProvider } from '../contexts/ThemeContext';

const THEME_KEY = '@taskforceai:theme_mode';
const mockAsyncState: Record<string, string | null> = {
  [THEME_KEY]: null,
};

globalThis.registerTestMock('@/utils/theme-storage', () => ({
  loadThemeMode: async () => mockAsyncState[THEME_KEY] ?? null,
  storeThemeMode: async (mode: string) => {
    mockAsyncState[THEME_KEY] = mode;
  },
  clearThemeMode: async () => {
    mockAsyncState[THEME_KEY] = null;
  },
}));

describe('ActionButton', () => {
  const renderWithTheme = async (ui: React.ReactElement) => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider>
          {ui}
        </ThemeProvider>
      );
    });
    // Wait for bootstrap effect in ThemeProvider
    await act(async () => {
      await Promise.resolve();
    });
    return renderer!;
  };

  it('renders children correctly', async () => {
    const renderer = await renderWithTheme(
      <ActionButton>
        Click Me
      </ActionButton>
    );
    const root = renderer.root;
    const text = root.findByType(Text);
    expect(text.props.children).toBe('Click Me');
  });

  it('handles onPress correctly', async () => {
    const onPress = jest.fn();
    const renderer = await renderWithTheme(
      <ActionButton onPress={onPress}>
        Click Me
      </ActionButton>
    );
    const touchable = renderer.root.findByType(TouchableOpacity);
    
    await act(async () => {
      touchable.props.onPress();
    });

    expect(onPress).toHaveBeenCalled();
  });

  it('disables when loading', async () => {
    const onPress = jest.fn();
    const renderer = await renderWithTheme(
      <ActionButton isLoading={true} onPress={onPress}>
        Click Me
      </ActionButton>
    );
    const touchable = renderer.root.findByType(TouchableOpacity);
    
    expect(touchable.props.disabled).toBe(true);
  });

  it('renders different variants', async () => {
    const renderer = await renderWithTheme(
      <ActionButton variant="danger">
        Delete
      </ActionButton>
    );
    const touchable = renderer.root.findByType(TouchableOpacity);
    expect(touchable.props.className).toContain('border-error/60');
  });
});
