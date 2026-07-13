import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const fetchAgentsMock = vi.fn();
const upsertAgentMock = vi.fn();
const persistComputerUseSessionModeMock = vi.fn();
const readStoredComputerUseSessionModeMock = vi.fn();
const persistOrchestrationConfigMock = vi.fn();
const readStoredOrchestrationConfigMock = vi.fn();
const getDesktopAppServerComputerUseModeMock = vi.fn();
const setDesktopAppServerComputerUseModeMock = vi.fn();

void vi.mock('../../../lib/api/agents', () => ({
  fetchAgents: fetchAgentsMock,
  upsertAgent: upsertAgentMock,
}));

void vi.mock('../../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

void vi.mock('../../../lib/prompt/computer-use-session-mode', () => ({
  COMPUTER_USE_SESSION_MODE_EVENT: 'taskforceai:computer-use-session-mode',
  COMPUTER_USE_SESSION_MODE_STORAGE_KEY: 'taskforceai:computer-use-session-mode',
  persistComputerUseSessionMode: persistComputerUseSessionModeMock,
  readStoredComputerUseSessionMode: readStoredComputerUseSessionModeMock,
}));

void vi.mock('../../../lib/prompt/orchestration-selection', () => ({
  persistOrchestrationConfig: persistOrchestrationConfigMock,
  readStoredOrchestrationConfig: readStoredOrchestrationConfigMock,
}));

void vi.mock('../../../lib/platform/desktop/app-server', () => ({
  getDesktopAppServerComputerUseMode: getDesktopAppServerComputerUseModeMock,
  setDesktopAppServerComputerUseMode: setDesktopAppServerComputerUseModeMock,
}));

import { usePromptFormPreferences } from './usePromptFormPreferences';

describe('usePromptFormPreferences', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fetchAgentsMock.mockResolvedValue({ ok: true, value: [] });
    upsertAgentMock.mockResolvedValue({
      ok: true,
      value: { id: 'agent-1', name: 'TaskForce Team' },
    });
    readStoredComputerUseSessionModeMock.mockReturnValue('logged_out');
    readStoredOrchestrationConfigMock.mockReturnValue(null);
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({
      enabled: false,
    });
    setDesktopAppServerComputerUseModeMock.mockResolvedValue({ enabled: true });
  });

  it('hydrates stored orchestration and keeps direct chat as the default prompt mode', async () => {
    readStoredOrchestrationConfigMock.mockReturnValue({
      roleModels: { planner: 'gpt-5' },
      budget: 25,
      agentCount: 6,
    });

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'browser',
        user: {
          email: 'test@example.com',
          full_name: 'Test User',
          quick_mode_enabled: true,
        },
        setErrorMessage: vi.fn(),
      })
    );

    await waitFor(() => expect(result.current.quickModeEnabled).toBe(true));
    await waitFor(() => expect(result.current.customRoleModels).toEqual({ planner: 'gpt-5' }));
    expect(result.current.budget).toBe(25);
    expect(result.current.agentCount).toBe(6);
  });

  it('keeps direct chat enabled for legacy users with stored agent-team defaults', async () => {
    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'browser',
        user: {
          email: 'test@example.com',
          full_name: 'Test User',
          quick_mode_enabled: false,
        },
        setErrorMessage: vi.fn(),
      })
    );

    await waitFor(() => expect(result.current.quickModeEnabled).toBe(true));
  });

  it('keeps Agent Teams explicit while product modes constrain autonomy', async () => {
    const props = {
      isAuthenticated: false,
      platformRuntime: 'browser' as const,
      user: null,
      setErrorMessage: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ mode }: { mode: 'chat' | 'work' | 'code' }) =>
        usePromptFormPreferences({ ...props, desktopTaskMode: mode }),
      { initialProps: { mode: 'chat' as 'chat' | 'work' | 'code' } }
    );

    await waitFor(() => expect(result.current.quickModeEnabled).toBe(true));
    expect(result.current.autonomyEnabled).toBe(false);

    act(() => rerender({ mode: 'work' }));
    await waitFor(() => expect(result.current.quickModeEnabled).toBe(true));

    act(() => result.current.setAutonomyEnabled(true));
    await waitFor(() => expect(result.current.autonomyEnabled).toBe(true));

    act(() => rerender({ mode: 'code' }));
    await waitFor(() => expect(result.current.quickModeEnabled).toBe(true));
    await waitFor(() => expect(result.current.autonomyEnabled).toBe(false));
  });

  it('hydrates autonomy from the backend without immediately upserting', async () => {
    fetchAgentsMock.mockResolvedValue({
      ok: true,
      value: [{ id: 'agent-1', name: 'TaskForce Team', autonomy_enabled: true }],
    });

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'browser',
        user: {
          email: 'test@example.com',
          full_name: 'Test User',
          quick_mode_enabled: false,
        },
        setErrorMessage: vi.fn(),
      })
    );

    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.autonomyEnabled).toBe(true));
    expect(upsertAgentMock).not.toHaveBeenCalled();
  });

  it('retries failed agent hydration and preserves a pending autonomy change', async () => {
    const setErrorMessage = vi.fn();
    fetchAgentsMock
      .mockResolvedValueOnce({
        ok: false,
        error: new Error('agents unavailable'),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: 'agent-1', name: 'TaskForce Team', autonomy_enabled: false }],
      });

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'browser',
        user: {
          email: 'test@example.com',
          full_name: 'Test User',
          quick_mode_enabled: true,
        },
        setErrorMessage,
      })
    );

    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));
    expect(setErrorMessage).toHaveBeenCalledWith(
      'Failed to load agent settings. Changes will retry before saving.'
    );

    act(() => {
      result.current.setAutonomyEnabled(true);
    });

    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(upsertAgentMock).toHaveBeenCalledWith({
        id: 'agent-1',
        name: 'TaskForce Team',
        autonomyEnabled: true,
      })
    );
    expect(result.current.autonomyEnabled).toBe(true);
  });

  it('persists computer-use session mode updates and responds to storage events', async () => {
    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: false,
        platformRuntime: 'browser',
        user: null,
        setErrorMessage: vi.fn(),
      })
    );

    act(() => {
      result.current.setComputerUseSessionMode('logged_in');
    });

    expect(persistComputerUseSessionModeMock).toHaveBeenCalledWith('logged_in');
    expect(result.current.computerUseSessionMode).toBe('logged_in');

    readStoredComputerUseSessionModeMock.mockReturnValue('logged_out');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'taskforceai:computer-use-session-mode',
        })
      );
    });

    await waitFor(() => expect(result.current.computerUseSessionMode).toBe('logged_out'));
  });

  it('responds to valid computer-use session mode events and ignores invalid modes', async () => {
    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: false,
        platformRuntime: 'browser',
        user: null,
        setErrorMessage: vi.fn(),
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('taskforceai:computer-use-session-mode', {
          detail: { mode: 'logged_in' },
        })
      );
    });

    await waitFor(() => expect(result.current.computerUseSessionMode).toBe('logged_in'));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('taskforceai:computer-use-session-mode', {
          detail: { mode: 'unknown' },
        })
      );
    });

    expect(result.current.computerUseSessionMode).toBe('logged_in');
  });

  it('hydrates and persists desktop computer-use mode through app-server', async () => {
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({ enabled: true });

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: false,
        platformRuntime: 'desktop',
        user: null,
        setErrorMessage: vi.fn(),
      })
    );

    await waitFor(() => expect(result.current.computerUseEnabled).toBe(true));
    expect(getDesktopAppServerComputerUseModeMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setComputerUseEnabled(false);
    });

    await waitFor(() => expect(setDesktopAppServerComputerUseModeMock).toHaveBeenCalledWith(false));
  });

  it('reports desktop computer-use persistence failures', async () => {
    const setErrorMessage = vi.fn();
    const persistError = new Error('desktop write failed');
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({
      enabled: false,
    });
    setDesktopAppServerComputerUseModeMock.mockRejectedValue(persistError);

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: false,
        platformRuntime: 'desktop',
        user: null,
        setErrorMessage,
      })
    );

    await waitFor(() => expect(getDesktopAppServerComputerUseModeMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setComputerUseEnabled(true);
    });

    await waitFor(() =>
      expect(setErrorMessage).toHaveBeenCalledWith(
        'Failed to save Computer Use mode. Your next run might not use it.'
      )
    );
  });

  it('reports failed browser agent setting sync after hydration', async () => {
    const setErrorMessage = vi.fn();
    fetchAgentsMock.mockResolvedValue({
      ok: true,
      value: [{ id: 'agent-1', name: 'TaskForce Team', autonomy_enabled: false }],
    });
    upsertAgentMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('upsert failed'),
    });

    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'browser',
        user: {
          email: 'test@example.com',
          full_name: 'Test User',
          quick_mode_enabled: true,
        },
        setErrorMessage,
      })
    );

    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setAutonomyEnabled(true);
    });

    await waitFor(() =>
      expect(upsertAgentMock).toHaveBeenCalledWith({
        id: 'agent-1',
        name: 'TaskForce Team',
        autonomyEnabled: true,
      })
    );
    expect(setErrorMessage).toHaveBeenCalledWith(
      'Failed to sync agent settings. Your changes might not be saved.'
    );
  });

  it('does not sync browser agent settings from desktop auth state', async () => {
    const { result } = renderHook(() =>
      usePromptFormPreferences({
        isAuthenticated: true,
        platformRuntime: 'desktop',
        user: {
          email: 'desktop@example.com',
          full_name: 'Desktop User',
          quick_mode_enabled: true,
        },
        setErrorMessage: vi.fn(),
      })
    );

    await waitFor(() => expect(getDesktopAppServerComputerUseModeMock).toHaveBeenCalledTimes(1));
    expect(fetchAgentsMock).not.toHaveBeenCalled();

    act(() => {
      result.current.setAutonomyEnabled(true);
    });

    await Promise.resolve();
    expect(upsertAgentMock).not.toHaveBeenCalled();
  });
});
