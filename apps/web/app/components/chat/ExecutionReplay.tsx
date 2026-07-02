import React, { useMemo, useState, useEffect } from 'react';
import { fetchExecutionTrace } from '@taskforceai/contracts/api/tasks';
import { ExecutionTrace, AgentStatus, ToolUsageEvent } from '../../lib/types';
import { logger } from '../../lib/logger';

interface ExecutionReplayProps {
  taskId: string;
  onFrameUpdate: (data: {
    agentStatuses: AgentStatus[];
    toolEvents: ToolUsageEvent[];
    reasoning?: string;
    isComplete: boolean;
  }) => void;
}

export const ExecutionReplay: React.FC<ExecutionReplayProps> = ({ taskId, onFrameUpdate }) => {
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTrace = async () => {
      setLoading(true);
      const result = await fetchExecutionTrace(taskId);
      if (result.ok) {
        setTrace(result.value);
        // Default to showing the full trace initially
        if (result.value.steps && Array.isArray(result.value.steps)) {
          setCurrentFrame(result.value.steps.length);
        }
      } else if (result.error.status !== 404) {
        logger.error('Failed to load execution trace', { taskId, error: result.error });
      }
      setLoading(false);
    };
    void loadTrace();
  }, [taskId]);

  const totalSteps = useMemo(() => {
    if (!trace?.steps || !Array.isArray(trace.steps)) return 0;
    return trace.steps.length;
  }, [trace]);

  useEffect(() => {
    if (!trace) return;

    const steps = (trace.steps as any[]) || [];
    // Slice steps up to current frame
    const visibleSteps = steps.slice(0, currentFrame);

    // Aggregated state for the current frame
    const agentStatuses: AgentStatus[] = [];
    const toolEvents: ToolUsageEvent[] = [];

    visibleSteps.forEach((step, index) => {
      // Reconstruct agent statuses
      // In our current implementation, each step is an AgentResult
      const agentId = step.AgentID;
      const status = index < currentFrame - 1 ? 'COMPLETED' : step.Status;

      agentStatuses.push({
        agent_id: agentId,
        status: status,
        progress: status === 'COMPLETED' ? 1 : 0.5,
        result: step.Response,
      });

      // Collect tool events up to this point
      if (step.ToolEvents) {
        toolEvents.push(...step.ToolEvents);
      }
    });

    onFrameUpdate({
      agentStatuses,
      toolEvents,
      reasoning: trace.report?.summary, // Use auditor summary as reasoning for now
      isComplete: currentFrame === totalSteps,
    });
  }, [currentFrame, trace, onFrameUpdate, totalSteps]);

  if (loading || !trace || totalSteps === 0) return null;

  return (
    <div className="execution-replay mt-4 flex flex-col gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-bold tracking-wider text-blue-400 uppercase">
            Trust Layer: Execution Replay
          </span>
          <span className="text-sm text-slate-300">
            Step {currentFrame} of {totalSteps}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Play/Pause buttons could go here later */}
        </div>
      </div>

      <input
        type="range"
        min="0"
        max={totalSteps}
        value={currentFrame}
        onChange={(e) => setCurrentFrame(parseInt(e.target.value, 10))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-blue-500"
      />

      <div className="flex justify-between text-[10px] font-medium text-slate-500 uppercase">
        <span>Start</span>
        <span>Goal Reached</span>
      </div>

      {trace.report && currentFrame === totalSteps && (
        <div className="mt-2 duration-500 animate-in fade-in slide-in-from-top-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <h4 className="mb-1 text-xs font-bold text-emerald-400 uppercase">Audit Summary</h4>
            <p className="text-sm leading-relaxed text-slate-200">{trace.report.summary}</p>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1 rounded bg-slate-900/50 p-2 text-center">
                <span className="text-[10px] text-slate-400 uppercase">Accuracy</span>
                <span className="text-sm font-bold text-slate-100">
                  {trace.report.rubric.accuracy}/5
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded bg-slate-900/50 p-2 text-center">
                <span className="text-[10px] text-slate-400 uppercase">Confidence</span>
                <span className="text-sm font-bold text-slate-100">
                  {trace.report.rubric.confidence}/5
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded bg-slate-900/50 p-2 text-center">
                <span className="text-[10px] text-slate-400 uppercase">Risk</span>
                <span
                  className={`text-sm font-bold capitalize ${
                    trace.report.rubric.risk === 'low'
                      ? 'text-emerald-400'
                      : trace.report.rubric.risk === 'medium'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                  }`}
                >
                  {trace.report.rubric.risk}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
