import { beforeEach, describe, expect, it, vi } from 'bun:test';

const mockChangeLanguage = vi.fn(async () => undefined);
const mockReadStorageItem = vi.fn();

vi.mock('i18next', () => ({
  default: {
    isInitialized: true,
    changeLanguage: mockChangeLanguage,
  },
}));

vi.mock('@taskforceai/shared/i18n/config', () => ({
  initializeI18n: vi.fn(),
}));

vi.mock('@taskforceai/shared/utils/browser-storage', () => ({
  readStorageItem: (key: string) => mockReadStorageItem(key),
}));

import { initializeI18n } from './i18n';

describe('initializeI18n', () => {
  beforeEach(() => {
    mockChangeLanguage.mockClear();
    mockReadStorageItem.mockReset();
  });

  it('applies the saved language when browser storage contains one', () => {
    mockReadStorageItem.mockReturnValue({ ok: true, value: 'es' });

    initializeI18n();

    expect(mockReadStorageItem).toHaveBeenCalledWith('i18nextLng');
    expect(mockChangeLanguage).toHaveBeenCalledWith('es');
  });

  it('skips language changes when nothing is stored', () => {
    mockReadStorageItem.mockReturnValue({ ok: false, error: { kind: 'missing' } });

    initializeI18n();

    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });
});
