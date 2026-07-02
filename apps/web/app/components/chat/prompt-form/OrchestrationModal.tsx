import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@taskforceai/ui-kit/dialog';
import { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import {
  buildPromptAgentCountOptions,
  getAgentRoleSlots,
  parsePromptBudgetInput,
} from '@taskforceai/shared';

interface OrchestrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOptionSummary[];
  roleModels: Record<string, string>;
  onRoleModelChange: (role: string, modelId: string) => void;
  budget?: number;
  onBudgetChange: (budget: number | undefined) => void;
  autonomyEnabled: boolean;
  defaultModelId: string | null;
  defaultModelLabel: string | null;
  userPlan?: string | null;
  agentCount?: number;
  onAgentCountChange?: (count: number) => void;
}

export const OrchestrationModal: React.FC<OrchestrationModalProps> = ({
  isOpen,
  onClose,
  models,
  roleModels,
  onRoleModelChange,
  budget,
  onBudgetChange,
  autonomyEnabled,
  defaultModelId,
  defaultModelLabel,
  userPlan,
  agentCount = 4,
  onAgentCountChange,
}) => {
  const modelOptionLabel = `${models.length} option${models.length === 1 ? '' : 's'} available`;

  const agentCountOptions = buildPromptAgentCountOptions(userPlan);
  const roleSlots = getAgentRoleSlots(agentCount);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-gray-700 bg-gray-900 text-white sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Custom Orchestration</DialogTitle>
          <DialogDescription className="text-gray-400">
            {autonomyEnabled
              ? 'Assign specialized models and set a mission budget for the autonomous organization.'
              : 'Assign specialized models to each agent role.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-4">
          {/* Boss Node (Input) + Global Budget + Agent Count */}
          <div className="flex w-full flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div className="w-44 rounded-lg border border-blue-500/50 bg-blue-600/20 p-3 text-center">
                <div className="mb-1 text-[10px] font-bold tracking-wider text-blue-300 uppercase">
                  Boss / Synthesis
                </div>
                <div className="text-sm font-medium text-white">
                  {defaultModelLabel || 'Default'}
                </div>
              </div>

              {/* Agent Count Selector */}
              <div className="w-44 rounded-lg border border-purple-500/50 bg-blue-600/20 p-3 text-center">
                <div className="mb-2 text-[10px] font-bold tracking-wider text-purple-300 uppercase">
                  Parallel Agents
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {agentCountOptions.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onAgentCountChange?.(n)}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                        agentCount === n
                          ? 'border-purple-400 bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mission Budget Input (Only for Autonomous/Organization mode) */}
              {autonomyEnabled && (
                <div className="w-44 rounded-lg border border-emerald-500/50 bg-emerald-600/20 p-3 text-center">
                  <div className="mb-1 text-[10px] font-bold tracking-wider text-emerald-300 uppercase">
                    Organization Budget
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-sm font-medium text-emerald-100">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Auto"
                      className="w-16 bg-transparent text-sm font-medium text-white focus:outline-none"
                      value={budget === undefined ? '' : budget}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          onBudgetChange(undefined);
                          return;
                        }
                        const budgetValue = parsePromptBudgetInput(e.target.value);
                        if (budgetValue === null) {
                          return;
                        }
                        onBudgetChange(budgetValue);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="my-1 h-8 w-0.5 bg-gray-700"></div>
            {/* Splitter */}
            <div className="relative h-0.5 w-full max-w-md bg-gray-700">
              <div className="absolute top-0 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-600"></div>
            </div>
          </div>

          {/* Workers Grid */}
          <div className="grid w-full grid-cols-2 gap-4">
            {roleSlots.map((role) => {
              const currentModelId = roleModels[role.id] || defaultModelId;

              return (
                <div
                  key={role.id}
                  className="group relative rounded-lg border border-gray-700 bg-gray-800 p-3 transition-colors hover:border-gray-600"
                >
                  {/* Connection Line */}
                  <div className="absolute -top-6 left-1/2 h-6 w-0.5 bg-gray-700 transition-colors group-hover:bg-gray-600"></div>

                  <div className="mb-1 text-xs font-bold tracking-wider text-gray-400 uppercase">
                    {role.label}
                  </div>
                  <select
                    className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                    value={currentModelId || ''}
                    aria-label={`${role.label} model (${modelOptionLabel})`}
                    onChange={(e) => onRoleModelChange(role.id, e.target.value)}
                  >
                    <option value="" disabled>
                      Select Model
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.usageMultiple ? `(${m.usageMultiple}x)` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[10px] text-gray-500">{role.description}</div>
                </div>
              );
            })}
          </div>

          {/* Merge & Output */}
          <div className="flex w-full flex-col items-center">
            {/* Merger */}
            <div className="relative mb-1 h-0.5 w-full max-w-md bg-gray-700">
              <div className="absolute top-0 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-600"></div>
            </div>
            <div className="h-8 w-0.5 bg-gray-700"></div>

            <div className="w-48 rounded-lg border border-blue-500/50 bg-blue-600/20 p-3 text-center">
              <div className="mb-1 text-xs font-bold tracking-wider text-blue-300 uppercase">
                Final Result
              </div>
              <div className="text-sm font-medium text-white">{defaultModelLabel || 'Default'}</div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-8 flex h-11 w-full items-center justify-center rounded-full bg-blue-600 px-8 text-sm font-bold tracking-widest text-white transition-all hover:bg-blue-500 active:scale-95 sm:w-auto"
            >
              APPLY CONFIGURATION
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
