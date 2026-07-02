import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

const mockLoggerError = vi.fn();
const mockReadCookieValue = vi.fn();
const mockSetCookieSafely = vi.fn();
const mockReloadPage = vi.fn();

vi.mock('@taskforceai/contracts/auth/logger', () => ({
  getAuthLogger: () => ({ error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@taskforceai/shared/utils/cookies', () => ({
  readCookieValue: (name: string) => mockReadCookieValue(name),
  setCookieSafely: (value: string) => mockSetCookieSafely(value),
}));

vi.mock('@taskforceai/shared/utils/browser-actions', () => ({
  reloadPage: () => mockReloadPage(),
}));

import { CookieBanner, hasAnalyticsConsent } from './CookieBanner';

describe('CookieBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mockReadCookieValue.mockReturnValue({ ok: false, error: { kind: 'missing' } });
    mockSetCookieSafely.mockReturnValue({ ok: true, value: true });
    mockReloadPage.mockReturnValue({ ok: true, value: undefined });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows after mount when no consent cookie exists', async () => {
    const view = render(<CookieBanner />);

    expect(await view.findByTestId('cookie-banner')).toBeInTheDocument();
  });

  it('stays hidden when consent has already been recorded', async () => {
    mockReadCookieValue.mockReturnValue({ ok: true, value: 'true' });

    const view = render(<CookieBanner />);

    await waitFor(() =>
      expect(mockReadCookieValue).toHaveBeenCalledWith('taskforceai-cookie-consent')
    );
    expect(view.queryByTestId('cookie-banner')).toBeNull();
  });

  it('records accepted consent and reloads the page', async () => {
    const view = render(<CookieBanner />);

    fireEvent.click(await view.findByText('Accept All'));

    expect(mockSetCookieSafely).toHaveBeenCalledWith(
      'taskforceai-cookie-consent=true; path=/; max-age=31536000'
    );
    expect(mockReloadPage).toHaveBeenCalled();
    await waitFor(() => expect(view.queryByTestId('cookie-banner')).toBeNull());
  });

  it('records rejected analytics consent and reloads the page', async () => {
    const view = render(<CookieBanner />);

    fireEvent.click(await view.findByText('Reject Non-Essential'));

    expect(mockSetCookieSafely).toHaveBeenCalledWith(
      'taskforceai-cookie-consent=false; path=/; max-age=31536000'
    );
    expect(mockReloadPage).toHaveBeenCalled();
  });

  it('leaves the banner visible when cookie persistence fails', async () => {
    mockSetCookieSafely.mockReturnValue({ ok: false, error: { kind: 'failed' } });

    const view = render(<CookieBanner />);
    fireEvent.click(await view.findByText('Accept All'));

    expect(mockReloadPage).not.toHaveBeenCalled();
    expect(view.getByTestId('cookie-banner')).toBeInTheDocument();
  });

  it('hides the banner when reload fails after consent is saved', async () => {
    mockReloadPage.mockReturnValue({ ok: false, error: { kind: 'failed' } });

    const view = render(<CookieBanner />);
    fireEvent.click(await view.findByText('Accept All'));

    expect(mockReloadPage).toHaveBeenCalled();
    await waitFor(() => expect(view.queryByTestId('cookie-banner')).toBeNull());
  });

  it('reports analytics consent only for an explicit true cookie', () => {
    mockReadCookieValue.mockReturnValueOnce({ ok: true, value: 'true' });
    expect(hasAnalyticsConsent()).toBe(true);

    mockReadCookieValue.mockReturnValueOnce({ ok: true, value: 'false' });
    expect(hasAnalyticsConsent()).toBe(false);

    mockReadCookieValue.mockReturnValueOnce({ ok: false, error: { kind: 'missing' } });
    expect(hasAnalyticsConsent()).toBe(false);
  });
});
