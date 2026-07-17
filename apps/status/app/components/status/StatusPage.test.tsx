import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import type { StatusResponse } from '@taskforceai/contracts/api/status';
import { StatusPage } from './StatusPage';

const HEALTHY_STATUS: StatusResponse = {
  overallStatus: 'operational',
  services: [
    {
      id: 'api',
      name: 'API Gateway',
      status: 'operational',
      uptimePercent: 99.95,
      uptimeHistory: [
        { date: '2026-02-27', status: 'operational' },
        { date: '2026-02-28', status: 'operational' },
      ],
    },
  ],
  incidents: [],
  lastUpdated: new Date().toISOString(),
};

const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;
const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

describe('StatusPage', () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    } else {
      delete (document as { hidden?: boolean }).hidden;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the status header visible while loading', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const view = render(<StatusPage />);

    expect(screen.getByText('TaskForceAI')).toBeTruthy();
    expect(screen.getByText('System Status')).toBeTruthy();

    view.unmount();
  });

  it('shows outage fallback and recovers after retry succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => HEALTHY_STATUS,
      });

    const view = render(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText('Status unavailable')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'System Status' })).toBeTruthy();
    });

    expect(screen.getByText('All Systems Operational')).toBeTruthy();
    expect(screen.getByText('API Gateway')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(1, '/status.json', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/status', expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(3, '/status.json', expect.any(Object));

    view.unmount();
  });

  it('preserves last known status when auto-refresh fails', async () => {
    Object.assign(globalThis, { jest: vi });
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => HEALTHY_STATUS,
      })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const view = render(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'System Status' })).toBeTruthy();
    });

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(
      screen.getByText('Live refresh failed. Displaying the last known status snapshot.')
    ).toBeTruthy();

    expect(screen.queryByText('Status unavailable')).toBeNull();
    expect(screen.getByText('API Gateway')).toBeTruthy();

    view.unmount();
  });

  it('pauses polling while hidden and refreshes immediately when visible again', async () => {
    Object.assign(globalThis, { jest: vi });
    vi.useFakeTimers();
    setDocumentHidden(false);

    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => HEALTHY_STATUS,
    });

    const view = render(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'System Status' })).toBeTruthy();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    view.unmount();
  });

  it('fails closed when every source has an invalid last updated timestamp', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ...HEALTHY_STATUS, lastUpdated: 'not-a-date' }),
    });

    const view = render(<StatusPage />);

    await waitFor(() => {
      expect(screen.getByText('Status unavailable')).toBeTruthy();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    view.unmount();
  });
});
