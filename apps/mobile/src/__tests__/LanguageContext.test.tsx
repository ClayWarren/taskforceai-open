import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Mock AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
}));

// Mock i18n
jest.mock('../i18n', () => ({
  __esModule: true,
  default: {
    language: 'en',
    changeLanguage: jest.fn(async () => {}),
    on: jest.fn(),
    off: jest.fn(),
    t: (s: string) => s,
  },
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslation: () => ({
    t: (str: string) => str,
    i18n: require('../i18n').default,
  }),
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

jest.mock('../logger', () => ({
  createModuleLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import i18nMock from '../i18n';
import { LanguageProvider } from '../contexts/LanguageContext';

describe('LanguageContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    for (const key in mockStorage) delete mockStorage[key];
    i18nMock.language = 'en';
  });


  afterEach(() => {
    jest.useRealTimers();
  });

  const renderWithProvider = async (): Promise<{
    renderer: TestRenderer.ReactTestRenderer;
  }> => {
    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <LanguageProvider>
          <></>
        </LanguageProvider>
      );
    });
    
    // Process all pending effects and microtasks
    await act(async () => {
      // Multiple flushes to ensure async init completes
      await Promise.resolve();
      await Promise.resolve();
      jest.runAllTimers();
    });
    
    if (!renderer) {
      throw new Error('Language provider did not initialize');
    }
    return { renderer };
  };



  it('initializes with default language', async () => {
    await renderWithProvider();
    expect(i18nMock.language).toBe('en');
  });

  it('loads language from storage on mount', async () => {
    mockStorage['@taskforceai:language'] = 'es';
    await renderWithProvider();
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('es');
  });


  it('handles storage errors gracefully during initialization', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.getItem.mockRejectedValue(new Error('Storage failure'));
    
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Expect NO throw because we removed re-throw from source code
    await renderWithProvider();
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });
});
