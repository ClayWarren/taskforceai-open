export const formatReasoningEffortLabel = (effort: string): string =>
  effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1);
