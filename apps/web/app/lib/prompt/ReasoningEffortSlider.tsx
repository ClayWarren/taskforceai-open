import type { CSSProperties } from 'react';

import { formatReasoningEffortLabel } from './reasoning-effort';

interface ReasoningEffortSliderProps {
  disabled?: boolean;
  levels: string[];
  selectedEffort: string | null;
  onChange: (effort: string) => void;
}

export function ReasoningEffortSlider({
  disabled = false,
  levels,
  selectedEffort,
  onChange,
}: ReasoningEffortSliderProps) {
  if (levels.length === 0 || !selectedEffort) return null;

  const selectedIndex = Math.max(0, levels.indexOf(selectedEffort));
  const progress = levels.length === 1 ? 100 : (selectedIndex / (levels.length - 1)) * 100;
  const sliderStyle = {
    '--reasoning-progress': `${progress}%`,
  } as CSSProperties;

  return (
    <>
      <input
        className="reasoning-effort-slider"
        style={sliderStyle}
        type="range"
        min={0}
        max={levels.length - 1}
        step={1}
        value={selectedIndex}
        disabled={disabled}
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
    </>
  );
}
