import { AudioLines } from 'lucide-react';

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

interface RealtimeVoiceSessionPanelProps {
  endedDurationMs: number | null;
  isActive: boolean;
  isCapturing: boolean;
  isPlaying: boolean;
}

export const getRealtimeVoiceActivityLabel = ({
  isCapturing,
  isPlaying,
}: {
  isCapturing: boolean;
  isPlaying: boolean;
}): string => {
  if (isCapturing) {
    return 'Listening';
  }
  if (isPlaying) {
    return 'Speaking';
  }
  return 'Voice session';
};

export function RealtimeVoiceSessionPanel({
  endedDurationMs,
  isActive,
  isCapturing,
  isPlaying,
}: RealtimeVoiceSessionPanelProps) {
  if (!isActive && endedDurationMs === null) {
    return null;
  }

  const activityLabel = getRealtimeVoiceActivityLabel({
    isCapturing,
    isPlaying,
  });

  if (!isActive && endedDurationMs !== null) {
    return (
      <div className="voice-session-panel voice-session-panel--ended" aria-live="polite">
        <AudioLines aria-hidden="true" size={18} />
        <span>Voice chat ended - {formatDuration(endedDurationMs)}</span>
      </div>
    );
  }

  return (
    <div className="voice-session-orb-shell" role="status" aria-label={activityLabel}>
      <div
        className={`voice-session-orb ${
          isPlaying ? 'voice-session-orb--speaking' : ''
        } ${isCapturing ? 'voice-session-orb--listening' : ''}`}
        aria-hidden="true"
      />
    </div>
  );
}
