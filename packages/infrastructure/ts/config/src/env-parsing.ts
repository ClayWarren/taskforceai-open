export const parseEnabledFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const parseSampleRate = (rawValue: string | undefined, fallbackValue: number): number => {
  if (rawValue === undefined) {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 1) {
    return fallbackValue;
  }

  return parsedValue;
};
