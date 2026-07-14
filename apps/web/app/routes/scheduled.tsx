import { createFileRoute } from '@tanstack/react-router';
import { Check, Clock3, Filter, Pause, Play, Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import { fetchAgents, upsertAgent, type Agent } from '../lib/api/agents';
import { useAuth } from '../lib/providers/AuthProvider';

export const Route = createFileRoute('/scheduled')({
  component: ScheduledPage,
});

type ScheduledFilter = 'active' | 'paused' | 'completed';

const completedStatuses = new Set(['completed', 'complete', 'succeeded', 'success']);

export const scheduledFilterForAgent = (agent: Agent): ScheduledFilter => {
  if (completedStatuses.has(agent.status.trim().toLowerCase())) return 'completed';
  return agent.autonomy_enabled ? 'active' : 'paused';
};

const displayNameForPrompt = (prompt: string): string => {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? '';
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 69).trimEnd()}…`;
};

const currentTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const updateAgentInList = (agents: Agent[], updated: Agent): Agent[] => {
  const index = agents.findIndex((agent) => agent.id === updated.id);
  if (index < 0) return [updated, ...agents];
  return agents.map((agent) => (agent.id === updated.id ? updated : agent));
};

function ScheduledPage() {
  return (
    <StandaloneRouteShell>
      <ScheduledPageContent />
    </StandaloneRouteShell>
  );
}

export function ScheduledPageContent() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filter, setFilter] = useState<ScheduledFilter>('active');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    if (!isAuthenticated) {
      setAgents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await fetchAgents();
    if (result.ok) {
      setAgents(result.value);
      setErrorMessage(null);
    } else {
      setErrorMessage(result.error.message);
    }
    setLoading(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthLoading) return;
    void refreshAgents();
  }, [isAuthLoading, refreshAgents]);

  const filteredAgents = useMemo(
    () => agents.filter((agent) => scheduledFilterForAgent(agent) === filter),
    [agents, filter]
  );

  const createSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const description = prompt.trim();
    if (!description || creating) return;

    setCreating(true);
    setErrorMessage(null);
    const result = await upsertAgent({
      name: displayNameForPrompt(description),
      description,
      autonomyEnabled: true,
      timezone: currentTimezone(),
      activeStart: '00:00',
      activeEnd: '23:59',
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      checkInterval: 600,
    });
    if (result.ok) {
      setAgents((current) => updateAgentInList(current, result.value));
      setPrompt('');
      setFilter('active');
    } else {
      setErrorMessage(result.error.message);
    }
    setCreating(false);
  };

  const toggleSchedule = async (agent: Agent) => {
    if (busyAgentId || scheduledFilterForAgent(agent) === 'completed') return;

    setBusyAgentId(agent.id);
    setErrorMessage(null);
    const result = await upsertAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? undefined,
      avatar: agent.avatar ?? undefined,
      modelId: agent.model_id ?? undefined,
      autonomyEnabled: !agent.autonomy_enabled,
      timezone: agent.timezone,
      activeStart: agent.active_start,
      activeEnd: agent.active_end,
      activeDays: agent.active_days ?? [],
      checkInterval: agent.check_interval,
    });
    if (result.ok) {
      setAgents((current) => updateAgentInList(current, result.value));
    } else {
      setErrorMessage(result.error.message);
    }
    setBusyAgentId(null);
  };

  const filterLabel = filter.charAt(0).toUpperCase() + filter.slice(1);

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pt-24 pb-16 sm:px-8 lg:pt-32">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Scheduled</h1>
            <p className="mt-3 text-base text-slate-400">
              Ask TaskForceAI to schedule tasks, set reminders, or monitor for updates.
            </p>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-slate-100">
            <Filter aria-hidden="true" size={16} />
            <span className="sr-only">Filter scheduled tasks</span>
            <select
              aria-label="Filter scheduled tasks"
              className="cursor-pointer appearance-none bg-transparent pr-1 text-slate-100 outline-none"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ScheduledFilter)}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>

        <form
          className="mt-10 flex items-center gap-3 rounded-[1.75rem] border border-white/10 bg-white/[0.09] px-5 py-3 shadow-[0_18px_55px_rgba(0,0,0,0.25)]"
          onSubmit={(event) => void createSchedule(event)}
        >
          <Plus aria-hidden="true" className="shrink-0 text-slate-300" size={22} />
          <input
            aria-label="Schedule a task"
            className="min-w-0 flex-1 bg-transparent py-1 text-base text-white placeholder:text-slate-400 focus:outline-none"
            placeholder="Schedule a task"
            value={prompt}
            onInput={(event) => setPrompt(event.currentTarget.value)}
            disabled={!isAuthenticated || creating}
          />
          <button
            type="submit"
            aria-label="Create scheduled task"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={!isAuthenticated || creating || !prompt.trim()}
          >
            <Send aria-hidden="true" size={17} />
          </button>
        </form>

        {errorMessage ? (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-8 grid gap-4">
          {isAuthLoading || loading ? (
            <ScheduledState
              icon={<Clock3 aria-hidden="true" />}
              message="Loading scheduled tasks…"
            />
          ) : !isAuthenticated ? (
            <ScheduledState
              icon={<Clock3 aria-hidden="true" />}
              message="Sign in to manage scheduled tasks."
            />
          ) : filteredAgents.length === 0 ? (
            <ScheduledState
              icon={<Clock3 aria-hidden="true" />}
              message={`No ${filterLabel.toLowerCase()} tasks yet.`}
            />
          ) : (
            filteredAgents.map((agent) => {
              const state = scheduledFilterForAgent(agent);
              const isBusy = busyAgentId === agent.id;
              return (
                <article
                  key={agent.id}
                  className="rounded-2xl border border-dashed border-white/20 bg-white/[0.035] px-5 py-4"
                >
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="text-xl">
                      {agent.avatar || '⏱️'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold text-white">{agent.name}</h2>
                      {agent.description ? (
                        <p className="mt-1 text-sm leading-6 text-slate-400">{agent.description}</p>
                      ) : null}
                    </div>
                    {state === 'completed' ? (
                      <Check aria-label="Completed" className="text-emerald-400" size={20} />
                    ) : (
                      <button
                        type="button"
                        aria-label={`${state === 'active' ? 'Pause' : 'Resume'} ${agent.name}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                        disabled={Boolean(busyAgentId)}
                        onClick={() => void toggleSchedule(agent)}
                      >
                        {state === 'active' ? (
                          <Pause aria-hidden="true" size={18} />
                        ) : (
                          <Play aria-hidden="true" size={18} />
                        )}
                        <span className="sr-only">{isBusy ? 'Updating' : null}</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function ScheduledState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-slate-500">
      <span className="text-slate-600">{icon}</span>
      <p>{message}</p>
    </div>
  );
}
