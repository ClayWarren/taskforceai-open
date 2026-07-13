export const getBudgetColor = (percentage: number): string => {
  if (percentage >= 90) return '#ef4444';
  if (percentage >= 70) return '#eab308';
  return '#3b82f6';
};
