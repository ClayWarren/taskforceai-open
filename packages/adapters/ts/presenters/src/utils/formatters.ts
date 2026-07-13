const TOOL_NAME_LABELS: Record<string, string> = {
  search_web: 'Web search',
  execute_code: 'Run code',
  read_file: 'Read file',
  write_file: 'Write file',
  mark_task_complete: 'Mark task complete',
  'hybrid.localreviewer': 'Local reviewer',
};

const titleCase = (value: string): string => {
  return value
    .split(' ')
    .map((word) => word.trim())
    .filter((word): word is string => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const formatToolName = (toolName?: string): string => {
  if (!toolName || !toolName.trim()) {
    return 'Tool';
  }
  const trimmed = toolName.trim();
  const normalizedKey = trimmed.toLowerCase();
  const label = TOOL_NAME_LABELS[normalizedKey];
  if (label) {
    return label;
  }
  const withSpaces = trimmed
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withSpaces) {
    return trimmed;
  }
  if (withSpaces.length <= 3) {
    return withSpaces.toUpperCase();
  }
  return titleCase(withSpaces);
};

export const formatDuration = (durationMs?: number | null): string | null => {
  if (!durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
};

export const formatStatus = (event: {
  success?: boolean;
  error?: string | null;
  status?: string | null;
}): { label: string; color: string } => {
  if (event.error || !event.success) {
    return { label: 'Failed', color: '#f87171' };
  }
  const status = event.status?.toLowerCase() ?? '';
  if (status.includes('running') || status.includes('pending') || status.includes('progress')) {
    return { label: 'Running', color: '#facc15' };
  }
  if (event.success) {
    return { label: 'Success', color: '#34d399' };
  }
  return { label: 'Running', color: '#facc15' };
};
