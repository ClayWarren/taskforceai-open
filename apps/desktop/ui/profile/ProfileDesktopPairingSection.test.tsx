import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const getSettings = vi.fn(async () => ({
  deviceId: 'mac-1',
  deviceName: 'Clay’s Mac',
  allowConnections: false,
  keepAwake: false,
}));
const updateSettings = vi.fn(async (patch: Record<string, boolean>) => ({
  deviceId: 'mac-1',
  deviceName: 'Clay’s Mac',
  allowConnections: patch['allowConnections'] ?? true,
  keepAwake: patch['keepAwake'] ?? false,
}));
const createPairingCode = vi.fn(async () => ({ code: 'ABCD-EFGH', expiresIn: 600 }));
const listControllers = vi.fn(async () => ({
  devices: [
    {
      deviceId: 'phone-1',
      deviceName: 'Clay’s iPhone',
      userAgent: 'TaskForceAI Mobile',
      lastConnectedAt: new Date().toISOString(),
      capabilities: ['threads', 'approvals', 'files'],
    },
  ],
}));
const revokeController = vi.fn(async () => ({ ok: true }));
const dispatchAuthChanged = vi.fn();

void vi.mock('../platform/app-server', () => ({
  getDesktopRemoteSettings: getSettings,
  updateDesktopRemoteSettings: updateSettings,
  createDesktopRemotePairingCode: createPairingCode,
  listDesktopRemoteControllers: listControllers,
  revokeDesktopRemoteController: revokeController,
}));

void vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,remote') },
}));

void vi.mock('../platform/auth-events', () => ({
  dispatchDesktopAppServerAuthChanged: dispatchAuthChanged,
}));

import { PairingSections } from './ProfileDesktopPairingSection';

describe('desktop Remote connections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables Remote, creates a one-time code, and revokes a controller', async () => {
    render(<PairingSections />);

    await waitFor(() => expect(screen.getByText('Clay’s iPhone')).toBeDefined());
    fireEvent.click(screen.getByRole('switch', { name: 'Allow connections' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ allowConnections: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('ABCD-EFGH')).toBeDefined());
    expect(screen.getByAltText('Remote connection QR code')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(revokeController).toHaveBeenCalledWith('phone-1'));
  });

  it('refreshes desktop auth immediately when Remote rejects an expired session', async () => {
    listControllers.mockRejectedValueOnce(new Error('Your session expired. Sign in again.'));

    render(<PairingSections />);

    await waitFor(() => expect(dispatchAuthChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Your session expired. Sign in again.')).toBeDefined();
  });
});
