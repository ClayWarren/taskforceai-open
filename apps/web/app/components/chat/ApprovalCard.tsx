import React, { useState } from 'react';
import type { PendingApproval } from '../../lib/types/index';
import { parseDiffPreview } from '@taskforceai/presenters/tool-usage/parsers';
import { submitTaskApprovalDecision } from '../../lib/api/tasks';
import { logger } from '../../lib/logger';
import { DiffPreview } from '../tool-usage/DiffPreview';

interface ApprovalCardProps {
  taskId: string;
  approval: PendingApproval;
  onDecision: (approved: boolean) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ taskId, approval, onDecision }) => {
  const [loading, setLoading] = useState(false);
  const diffPreview = parseDiffPreview(approval.metadata);

  const handleDecision = async (approved: boolean) => {
    setLoading(true);
    try {
      await submitTaskApprovalDecision(taskId, { approved });
      onDecision(approved);
    } catch (error) {
      logger.error('Failed to submit approval decision', { error, taskId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="approval-card mt-4 duration-500 animate-in fade-in slide-in-from-top-4">
      <div className="overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/5 shadow-lg shadow-amber-500/10 backdrop-blur-sm">
        <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <div className="flex h-8 w-8 animate-pulse items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-widest text-amber-500 uppercase">
              Action Required
            </span>
            <span className="text-sm font-semibold text-slate-200">
              {approval.agentName} is requesting permission
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                Tool Request
              </span>
              <div className="flex items-center gap-2 rounded-lg bg-slate-950/50 p-2.5 font-mono text-sm text-amber-200">
                <span className="opacity-50">$</span>
                <span>{approval.permission}</span>
                {approval.patterns.length > 0 && (
                  <>
                    <span className="mx-1 text-slate-600">→</span>
                    <span className="text-slate-300">{approval.patterns.join(', ')}</span>
                  </>
                )}
              </div>
            </div>

            {diffPreview && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  Proposed Changes
                </span>
                <DiffPreview diff={diffPreview} maxLinesPerFile={48} />
              </div>
            )}

            {!diffPreview && approval.metadata && Object.keys(approval.metadata).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  Details
                </span>
                <pre className="max-h-32 overflow-y-auto rounded-lg bg-slate-950/30 p-2.5 text-xs text-slate-400">
                  {JSON.stringify(approval.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void handleDecision(true);
              }}
              disabled={loading}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Approve Action'}
            </button>
            <button
              onClick={() => {
                void handleDecision(false);
              }}
              disabled={loading}
              className="flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm font-bold text-rose-400 transition hover:bg-rose-500/20 active:scale-[0.98] disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
