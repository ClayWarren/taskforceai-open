import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@taskforceai/ui-kit/dialog';
import { calculateBudgetStats, getBudgetColor, parsePromptBudgetInput } from '@taskforceai/shared';

interface AutonomousPanelProps {
  isOpen: boolean;
  onClose: () => void;
  budget?: number;
  onBudgetChange: (budget: number | undefined) => void;
  currentSpend?: number;
  budgetLimit?: number | null;
  isStreaming?: boolean;
}

export const AutonomousPanel: React.FC<AutonomousPanelProps> = ({
  isOpen,
  onClose,
  budget,
  onBudgetChange,
  currentSpend = 0,
  budgetLimit = null,
  isStreaming = false,
}) => {
  const { effectiveBudget, budgetPercentage, remaining } = calculateBudgetStats(
    currentSpend,
    budget,
    budgetLimit
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-gray-700 bg-gray-900 text-white sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>🤖</span>
            <span>Autonomous Mode</span>
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Set a budget limit for autonomous task execution.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* Budget Input */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold tracking-wider text-gray-400 uppercase">
              Budget Limit
            </label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-white">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="No limit"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-lg font-medium text-white focus:border-blue-500 focus:outline-none"
                value={budget === undefined ? '' : budget}
                onChange={(e) => {
                  if (e.target.value === '') {
                    onBudgetChange(undefined);
                    return;
                  }
                  const budgetValue = parsePromptBudgetInput(e.target.value);
                  if (budgetValue === null) return;
                  onBudgetChange(budgetValue);
                }}
              />
            </div>
            <p className="text-xs text-gray-500">
              The autonomous organization will stop when this limit is reached.
            </p>
          </div>

          {/* Current Spend (during streaming) */}
          {isStreaming && (
            <div className="flex flex-col gap-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
                  Current Spend
                </span>
                <span className="text-lg font-bold text-white">${currentSpend.toFixed(2)}</span>
              </div>

              {effectiveBudget !== undefined && effectiveBudget !== null && effectiveBudget > 0 && (
                <>
                  {/* Progress Bar */}
                  <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${budgetPercentage}%`,
                        backgroundColor: getBudgetColor(budgetPercentage),
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>${currentSpend.toFixed(2)} spent</span>
                    <span>${remaining?.toFixed(2)} remaining</span>
                  </div>
                </>
              )}

              {(effectiveBudget === undefined || effectiveBudget === null) && (
                <p className="text-xs text-gray-500">
                  No budget limit set. Running until task completes.
                </p>
              )}
            </div>
          )}

          {/* Info */}
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
            <p className="text-xs text-blue-300">
              <strong>Autonomous Mode</strong> enables persistent, self-directed task execution. The
              AI organization will work independently until your goal is achieved or the budget is
              exhausted.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
