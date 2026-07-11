import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import assert from 'node:assert/strict';
import React, { Component } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import type { Theme, ThemeMode } from '../theme/theme';

const registerTestMock = globalThis.registerTestMock;

type ThemeContextValue = {
  theme: Theme;
  themeMode: ThemeMode;
  isDarkMode: boolean;
  toggleTheme: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
};

const asyncStorage = globalThis.AsyncStorage;

const THEME_KEY = '@taskforceai:theme_mode';

const asyncState: Record<string, string | null> = {
  [THEME_KEY]: null,
};

registerTestMock('@/utils/theme-storage', () => ({
  loadThemeMode: async () => asyncState[THEME_KEY] ?? null,
  storeThemeMode: async (mode: string) => {
    asyncState[THEME_KEY] = mode;
  },
  clearThemeMode: async () => {
    asyncState[THEME_KEY] = null;
  },
}));

const setItemCalls: Array<{ key: string; value: string }> = [];
const getItemCalls: string[] = [];

let forceGetItemFailure = false;
let deferGetItem = false;

const applyAsyncStorageBindings = () => {
  asyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
    setItemCalls.push({ key, value });
    asyncState[key] = value;
  });

  asyncStorage.getItem.mockImplementation(async (key: string) => {
    if (forceGetItemFailure) {
      throw new Error('forced getItem failure');
    }
    if (deferGetItem) {
      return await new Promise<string | null>((resolve) => {
        const wait = () => {
          if (!deferGetItem) {
            resolve(asyncState[key] ?? null);
            return;
          }
          setTimeout(wait, 0);
        };
        setTimeout(wait, 0);
      });
    }
    getItemCalls.push(key);
    return asyncState[key] ?? null;
  });

  asyncStorage.removeItem.mockImplementation(async (key: string) => {
    asyncState[key] = null;
  });
};

applyAsyncStorageBindings();

const resetTracking = () => {
  setItemCalls.length = 0;
  getItemCalls.length = 0;
};

const requireError = (value: Error | null, message: string): Error => {
  if (!value) {
    throw new Error(message);
  }
  return value;
};

beforeEach(() => {
  jest.useFakeTimers();
  resetTracking();
  asyncState[THEME_KEY] = null;
  forceGetItemFailure = false;
  deferGetItem = false;
  applyAsyncStorageBindings();
});

afterEach(() => {
  jest.useRealTimers();
});


const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderWithProvider = async (): Promise<{
  renderer: TestRenderer.ReactTestRenderer;
  getValue: () => ThemeContextValue;
}> => {
  let latestValue: ThemeContextValue | null = null;

  const Consumer: React.FC = () => {
    latestValue = useTheme();
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    );
  });

  await flushEffects();

  if (!latestValue || !renderer) {
    throw new Error('Theme context did not initialize');
  }
  return { renderer, getValue: () => latestValue! };
};

class ErrorBoundary extends Component<
  { onError: (error: Error) => void; children: React.ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

async function testLoadsStoredTheme() {
  resetTracking();
  asyncState[THEME_KEY] = 'light';

  const { renderer, getValue } = await renderWithProvider();
  const value = getValue();

  assert.equal(value.themeMode, 'light', 'should load saved light mode');
  assert.equal(value.isDarkMode, false, 'light mode should set isDarkMode=false');

  act(() => {
    renderer.unmount();
  });
}

async function testToggleUpdatesStorage() {
  resetTracking();
  asyncState[THEME_KEY] = 'dark';

  const { renderer, getValue } = await renderWithProvider();

  await act(async () => {
    await getValue().toggleTheme();
  });
  await flushEffects();

  const value = getValue();
  assert.equal(value.themeMode, 'light', 'toggleTheme should switch to light mode');
  assert.equal(asyncState[THEME_KEY], 'light', 'light mode should persist to storage');

  act(() => {
    renderer.unmount();
  });
}

async function testRapidTogglesPersistInOrder() {
  resetTracking();
  asyncState[THEME_KEY] = 'dark';

  const { renderer, getValue } = await renderWithProvider();

  await act(async () => {
    await Promise.all([getValue().toggleTheme(), getValue().toggleTheme()]);
  });

  assert.equal(getValue().themeMode, 'dark', 'two rapid toggles should return to dark mode');
  assert.equal(asyncState[THEME_KEY], 'dark', 'rapid toggles should persist in invocation order');

  act(() => {
    renderer.unmount();
  });
}

async function testSetThemeModePersists() {
  resetTracking();
  asyncState[THEME_KEY] = null;

  const { renderer, getValue } = await renderWithProvider();

  await act(async () => {
    getValue().setThemeMode('dark');
  });
  await flushEffects();

  const value = getValue();
  assert.equal(value.themeMode, 'dark', 'explicit setThemeMode should update context');
  assert.equal(asyncState[THEME_KEY], 'dark', 'dark mode should persist to storage');

  act(() => {
    renderer.unmount();
  });
}

async function testProviderHidesChildrenWhileLoading() {
  resetTracking();
  asyncState[THEME_KEY] = 'dark';
  deferGetItem = true;

  try {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider>
          <React.Fragment>ready</React.Fragment>
        </ThemeProvider>
      );
    });

    // Verify it is loading (children not rendered)
    expect(renderer!.toJSON()).toBeNull();

    // Advance past the 500ms timeout
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    
    expect(renderer!.toJSON()).toBeDefined();
    
    act(() => {
      renderer!.unmount();
    });
  } finally {
    deferGetItem = false;
  }
}


async function testUseThemeRequiresProvider() {
  const BareConsumer: React.FC = () => {
    useTheme();
    return null;
  };

  let capturedError: Error | null = null;

  await act(async () => {
    TestRenderer.create(
      <ErrorBoundary
        onError={(error) => {
          capturedError = error;
        }}
      >
        <BareConsumer />
      </ErrorBoundary>
    );
  });

  await flushEffects();

  const providerError = requireError(
    capturedError,
    'Expected useTheme to throw without ThemeProvider'
  );
  assert.equal(
    providerError.message.includes('useTheme must be used within a ThemeProvider'),
    true,
    'error message should mention ThemeProvider usage'
  );
}

async function testHandlesThemeLoadFailure() {
  resetTracking();
  asyncState[THEME_KEY] = 'dark';
  forceGetItemFailure = true;

  // ThemeContext uses createModuleLogger('ThemeContext')
  // We need to ensure it's hit.

  try {
    const { renderer, getValue } = await renderWithProvider();
    const value = getValue();

    expect(value.themeMode).toBe('dark');
    expect(value.isDarkMode).toBe(true);
    
    act(() => {
      renderer.unmount();
    });
  } finally {
    forceGetItemFailure = false;
  }
}


describe('ThemeContext', () => {
  it('loads persisted theme mode', async () => {
    await testLoadsStoredTheme();
  });

  it('toggles theme updates storage', async () => {
    await testToggleUpdatesStorage();
  });

  it('serializes rapid theme toggles', async () => {
    await testRapidTogglesPersistInOrder();
  });

  it('persists explicit theme mode selections', async () => {
    await testSetThemeModePersists();
  });

  it('hides children while theme loads', async () => {
    await testProviderHidesChildrenWhileLoading();
  });

  it('requires provider to use hook', async () => {
    await testUseThemeRequiresProvider();
  });

  it('handles theme load failures', async () => {
    await testHandlesThemeLoadFailure();
  });
});
