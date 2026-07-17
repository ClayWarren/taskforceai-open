'use client';

import { Check, ChevronDown, Circle, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

type PlanItem = { label: string; status: 'pending' | 'in_progress' | 'completed' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeStatus = (value: unknown): PlanItem['status'] => {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  if (['completed', 'complete', 'done', 'finished'].includes(status)) return 'completed';
  if (['in_progress', 'in-progress', 'active', 'running', 'processing'].includes(status)) {
    return 'in_progress';
  }
  return 'pending';
};

const planItemsFromValue = (value: unknown): PlanItem[] => {
  const nested = isRecord(value) && 'plan' in value ? value['plan'] : value;
  if (typeof nested === 'string') {
    return nested
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .map((label) => ({ label, status: 'pending' }));
  }
  if (!Array.isArray(nested)) return [];
  return nested.flatMap((item) => {
    if (typeof item === 'string') return [{ label: item, status: 'pending' as const }];
    if (!isRecord(item)) return [];
    const label = [item['step'], item['text'], item['content'], item['title']].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== ''
    );
    return label ? [{ label, status: normalizeStatus(item['status']) }] : [];
  });
};

export const collectLivePlanItems = (statuses: readonly unknown[]): PlanItem[] => {
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    const status = statuses[index];
    if (!isRecord(status)) continue;
    const plan = status['plan'] ?? status['todos'];
    const items = planItemsFromValue(plan);
    if (items.length > 0) return items;
  }
  return [];
};

export function DesktopPlanPanel({ agentStatuses }: { agentStatuses: readonly unknown[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const items = useMemo(() => collectLivePlanItems(agentStatuses), [agentStatuses]);
  if (items.length === 0) return null;
  const completed = items.filter((item) => item.status === 'completed').length;

  return (
    <aside
      className="fixed top-24 right-6 z-[125] w-72 overflow-hidden rounded-2xl border border-blue-400/20 bg-slate-950/90 text-slate-100 shadow-2xl backdrop-blur-xl"
      aria-label="Live task plan"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span>
          <span className="block text-xs font-semibold tracking-wide text-blue-200 uppercase">
            Plan
          </span>
          <span className="text-[11px] text-slate-500">
            {completed} of {items.length} complete
          </span>
        </span>
        <ChevronDown size={15} className={`transition ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      {!collapsed ? (
        <ol className="max-h-72 space-y-1 overflow-y-auto border-t border-white/8 p-2">
          {items.map((item, index) => (
            <li
              key={`${index}-${item.label}`}
              className="flex gap-2 rounded-lg px-2 py-2 text-xs text-slate-300"
            >
              {item.status === 'completed' ? (
                <Check size={15} className="shrink-0 text-emerald-400" />
              ) : item.status === 'in_progress' ? (
                <LoaderCircle size={15} className="shrink-0 animate-spin text-blue-300" />
              ) : (
                <Circle size={15} className="shrink-0 text-slate-600" />
              )}
              <span className={item.status === 'completed' ? 'text-slate-500 line-through' : ''}>
                {item.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
