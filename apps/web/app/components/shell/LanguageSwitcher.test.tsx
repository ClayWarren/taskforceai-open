import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const mockI18n = {
  language: 'en',
  changeLanguage: vi.fn().mockResolvedValue(undefined),
};

void mock.module('react-i18next', () => ({
  useTranslation: () => ({
    i18n: mockI18n,
  }),
}));

const { default: LanguageSwitcher } = await import('./LanguageSwitcher');

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    mockI18n.language = 'en';
    mockI18n.changeLanguage.mockClear();
  });

  it('renders both language buttons', () => {
    render(<LanguageSwitcher />);

    const enButton = screen.getByRole('button', { name: /switch to english/i });
    const esButton = screen.getByRole('button', { name: /switch to spanish/i });
    expect(enButton).toBeTruthy();
    expect(esButton).toBeTruthy();
    expect(enButton).toHaveAttribute('type', 'button');
    expect(esButton).toHaveAttribute('type', 'button');
  });

  it('disables English button when current language is English', () => {
    render(<LanguageSwitcher />);

    const enButton = screen.getByRole('button', { name: /switch to english/i });
    expect(enButton).toBeDisabled();
  });

  it('enables Spanish button when current language is English', () => {
    render(<LanguageSwitcher />);

    const esButton = screen.getByRole('button', { name: /switch to spanish/i });
    expect(esButton).toBeEnabled();
  });
});
