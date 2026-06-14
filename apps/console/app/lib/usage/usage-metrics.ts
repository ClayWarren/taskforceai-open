const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const elapsedBillingPeriodDays = ({
  periodStart,
  periodEnd,
  now = new Date(),
}: {
  periodStart?: string | null;
  periodEnd?: string | null;
  now?: Date;
}): number => {
  const start = parseDate(periodStart) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const parsedEnd = parseDate(periodEnd);
  const effectiveEnd = parsedEnd && now > parsedEnd ? parsedEnd : now;

  const startDay = startOfLocalDay(start);
  const endDay = startOfLocalDay(effectiveEnd);
  if (endDay < startDay) return 1;

  return Math.max(1, Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY) + 1);
};

export const averageDailyRequests = ({
  requestsThisMonth,
  periodStart,
  periodEnd,
  now,
}: {
  requestsThisMonth: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  now?: Date;
}): number =>
  Math.round(
    requestsThisMonth /
      elapsedBillingPeriodDays({
        periodStart,
        periodEnd,
        now,
      })
  );
