'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@taskforceai/ui-kit/tooltip';
import { useEffect, useState } from 'react';

import { logger } from '../../../../lib/logger';
import { getDesktopAppServerContextSummary } from '../../../../lib/platform/desktop-api';
import type { AppServerContextSummary } from '@taskforceai/contracts/app-server';

const formatTokens = (tokens: number): string => {
  if (tokens < 1_000) return String(tokens);
  const thousands = tokens / 1_000;
  return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
};

export function ContextWindowIndicator() {
  const [summary, setSummary] = useState<AppServerContextSummary | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getDesktopAppServerContextSummary();
        if (active) setSummary(next);
      } catch (error) {
        logger.warn('Failed to load desktop context window summary', { error });
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!summary || summary.maxTokens <= 0) return null;
  const percentage = Math.min(100, Math.round((summary.estimatedTokens / summary.maxTokens) * 100));
  const circumference = 2 * Math.PI * 8;
  const dashOffset = circumference * (1 - percentage / 100);

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
            aria-label={`Context window ${percentage}% full`}
          >
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 20 20">
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.22"
                strokeWidth="3"
              />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 10 10)"
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border border-white/10 bg-[#2a2a2a] px-4 py-3 text-center text-slate-100 shadow-xl"
        >
          <div className="text-sm text-slate-400">Context window:</div>
          <div className="mt-1 text-base">{percentage}% full</div>
          <div className="mt-2 text-sm font-medium">
            ~{formatTokens(summary.estimatedTokens)} / {formatTokens(summary.maxTokens)} tokens used
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
