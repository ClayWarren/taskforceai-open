import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const fetchAgents = vi.fn();
const upsertAgent = vi.fn();
let authState = { isAuthenticated: true, isLoading: false };

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}));

vi.mock('../app-shell/ProductShellProviders', () => ({
  ProductShellProviders: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../app-shell/StandaloneRouteShell', () => ({
  StandaloneRouteShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../lib/api/agents', () => ({
  fetchAgents,
  upsertAgent,
}));

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: () => authState,
}));

const { Route, ScheduledPageContent, scheduledFilterForAgent } = await import('./scheduled');

const timestamp = '2026-07-12T19:00:00';

const agentFixture = (overrides: Record<string, unknown> = {}) => ({
  active_days: [0, 1, 2, 3, 4, 5, 6],
  active_end: '23:59',
  active_start: '00:00',
  autonomy_enabled: true,
  avatar: '⏱️',
  check_interval: 600,
  created_at: timestamp,
  description: 'Review progress and risks',
  id: 'agent-1',
  last_run_at: null,
  model_id: null,
  name: 'Weekly status review',
  next_run_at: timestamp,
  status: 'active',
  timezone: 'America/Chicago',
  updated_at: timestamp,
  user_id: 1,
  ...overrides,
});

describe('ScheduledPageContent', () => {
  beforeEach(() => {
    authState = { isAuthenticated: true, isLoading: false };
    fetchAgents.mockReset();
    upsertAgent.mockReset();
    fetchAgents.mockResolvedValue({ ok: true, value: [agentFixture()] });
  });

  afterEach(() => cleanup());

  it('loads and filters scheduled tasks', async () => {
    render(<ScheduledPageContent />);

    expect(await screen.findByText('Weekly status review')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter scheduled tasks'), {
      target: { value: 'paused' },
    });

    expect(screen.queryByText('Weekly status review')).toBeNull();
    expect(screen.getByText('No paused tasks yet.')).toBeTruthy();
  });

  it('creates a scheduled task from the composer', async () => {
    const created = agentFixture({ id: 'agent-2', name: 'Monitor releases' });
    upsertAgent.mockResolvedValue({ ok: true, value: created });
    render(<ScheduledPageContent />);

    await screen.findByText('Weekly status review');
    fireEvent.input(screen.getByLabelText('Schedule a task'), {
      target: { value: 'Monitor releases' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create scheduled task' }));

    await waitFor(() => expect(upsertAgent).toHaveBeenCalledTimes(1));
    expect(upsertAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Monitor releases',
        description: 'Monitor releases',
        autonomyEnabled: true,
        checkInterval: 600,
      })
    );
    expect(await screen.findByText('Monitor releases')).toBeTruthy();
  });

  it('pauses an active scheduled task', async () => {
    upsertAgent.mockResolvedValue({
      ok: true,
      value: agentFixture({ autonomy_enabled: false }),
    });
    render(<ScheduledPageContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Pause Weekly status review' }));

    await waitFor(() =>
      expect(upsertAgent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-1', autonomyEnabled: false })
      )
    );
    expect(screen.getByText('No active tasks yet.')).toBeTruthy();
  });

  it('classifies completed agents before autonomy state', () => {
    expect(scheduledFilterForAgent(agentFixture({ status: 'completed' }))).toBe('completed');
    expect(scheduledFilterForAgent(agentFixture({ autonomy_enabled: false }))).toBe('paused');
  });

  it('renders authentication, loading, and fetch failure states', async () => {
    authState = { isAuthenticated: false, isLoading: false };
    const { rerender } = render(<ScheduledPageContent />);
    expect(await screen.findByText('Sign in to manage scheduled tasks.')).toBeTruthy();
    expect(fetchAgents).not.toHaveBeenCalled();

    authState = { isAuthenticated: true, isLoading: true };
    rerender(<ScheduledPageContent />);
    expect(screen.getByText('Loading scheduled tasks…')).toBeTruthy();

    cleanup();
    authState = { isAuthenticated: true, isLoading: false };
    fetchAgents.mockResolvedValueOnce({ ok: false, error: new Error('Agents unavailable') });
    render(<ScheduledPageContent />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Agents unavailable');
  });

  it('reports create and resume failures and truncates long task names', async () => {
    const paused = agentFixture({
      autonomy_enabled: false,
      avatar: null,
      description: null,
      model_id: null,
      active_days: null,
    });
    fetchAgents.mockResolvedValue({ ok: true, value: [paused] });
    upsertAgent.mockResolvedValueOnce({ ok: false, error: new Error('Resume failed') });
    render(<ScheduledPageContent />);
    fireEvent.change(await screen.findByLabelText('Filter scheduled tasks'), {
      target: { value: 'paused' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Weekly status review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resume failed');

    const description = `${'A'.repeat(80)}\nSecond line`;
    upsertAgent.mockResolvedValueOnce({ ok: false, error: new Error('Create failed') });
    fireEvent.input(screen.getByLabelText('Schedule a task'), { target: { value: description } });
    fireEvent.click(screen.getByRole('button', { name: 'Create scheduled task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Create failed');
    expect(upsertAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: `${'A'.repeat(69)}…`,
        description: `${'A'.repeat(80)}Second line`,
      })
    );
  });

  it('renders completed task state', async () => {
    fetchAgents.mockResolvedValue({
      ok: true,
      value: [agentFixture({ status: 'success', avatar: '', description: '' })],
    });
    render(<ScheduledPageContent />);
    fireEvent.change(await screen.findByLabelText('Filter scheduled tasks'), {
      target: { value: 'completed' },
    });
    expect(await screen.findByLabelText('Completed')).toBeTruthy();
  });

  it('renders the route wrapper and falls back when timezone detection fails', async () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    Intl.DateTimeFormat = (() => {
      throw new Error('timezone unavailable');
    }) as unknown as typeof Intl.DateTimeFormat;
    const created = agentFixture({ id: 'agent-utc', name: 'UTC task' });
    upsertAgent.mockResolvedValue({ ok: true, value: created });
    const RouteComponent = (Route as unknown as { component: React.ComponentType }).component;
    render(<RouteComponent />);
    await screen.findByText('Weekly status review');
    fireEvent.input(screen.getByLabelText('Schedule a task'), { target: { value: 'UTC task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create scheduled task' }));
    await waitFor(() =>
      expect(upsertAgent).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'UTC' }))
    );
    Intl.DateTimeFormat = originalDateTimeFormat;
  });
});
