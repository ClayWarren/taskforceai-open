import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../../tests/setup/dom';

import { TauriReadySignal } from './TauriReadySignal';

const mockDetectRuntime = mock(() => 'browser');
const mockInvokeTauri = mock(() => Promise.resolve(undefined));

mock.module('@taskforceai/shared/utils/runtime', () => ({
  detectRuntime: mockDetectRuntime,
}));

mock.module('./desktop/bridge', () => ({
  invokeTauri: mockInvokeTauri,
}));

describe('TauriReadySignal', () => {
  beforeEach(() => {
    mockDetectRuntime.mockClear();
    mockInvokeTauri.mockClear();
  });

  it('signals Tauri readiness when runtime is desktop', async () => {
    mockDetectRuntime.mockReturnValue('desktop');

    render(<TauriReadySignal />);

    await waitFor(() => {
      expect(mockInvokeTauri).toHaveBeenCalledWith('frontend_ready');
    });
  });

  it('does not signal readiness for browser runtime', () => {
    mockDetectRuntime.mockReturnValue('browser');

    render(<TauriReadySignal />);

    expect(mockInvokeTauri).not.toHaveBeenCalled();
  });
});
