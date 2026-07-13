import { BrainCircuit } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@taskforceai/ui-kit/popover';

import { formatReasoningEffortLabel } from '../../../lib/prompt/reasoning-effort';

interface ReasoningEffortControlProps {
  disabled?: boolean;
  levels: string[];
  selectedEffort: string | null;
  onChange: (effort: string) => void;
}

export function ReasoningEffortControl({
  disabled = false,
  levels,
  selectedEffort,
  onChange,
}: ReasoningEffortControlProps) {
  if (levels.length === 0 || !selectedEffort) {
    return null;
  }

  const selectedIndex = Math.max(0, levels.indexOf(selectedEffort));
  const progress = levels.length === 1 ? 100 : (selectedIndex / (levels.length - 1)) * 100;
  const sliderStyle = {
    '--reasoning-progress': `${progress}%`,
  } as CSSProperties;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="reasoning-effort-trigger"
          disabled={disabled}
          aria-label={`Reasoning effort: ${formatReasoningEffortLabel(selectedEffort)}`}
          title="Reasoning effort"
        >
          <BrainCircuit aria-hidden="true" size={16} strokeWidth={2.15} />
          <span>{formatReasoningEffortLabel(selectedEffort)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={12} className="reasoning-effort-popover">
        <div className="reasoning-effort-popover__header">
          <div>
            <div className="reasoning-effort-popover__eyebrow">Model controls</div>
            <div className="reasoning-effort-popover__title">Reasoning effort</div>
          </div>
          <BrainCircuit aria-hidden="true" size={20} strokeWidth={2.1} />
        </div>
        <input
          className="reasoning-effort-slider"
          style={sliderStyle}
          type="range"
          min={0}
          max={levels.length - 1}
          step={1}
          value={selectedIndex}
          aria-label="Reasoning effort"
          aria-valuetext={formatReasoningEffortLabel(selectedEffort)}
          onInput={(event) => onChange(levels[Number(event.currentTarget.value)] ?? selectedEffort)}
        />
        <div className="reasoning-effort-popover__labels" aria-hidden="true">
          {levels.map((level) => (
            <span key={level} className={level === selectedEffort ? 'is-selected' : undefined}>
              {formatReasoningEffortLabel(level)}
            </span>
          ))}
        </div>
        <div className="reasoning-effort-popover__hint">
          Faster responses
          <span>Deeper reasoning</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
