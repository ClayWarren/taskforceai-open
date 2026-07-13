const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const TIMESTAMP_WITHOUT_TIMEZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?$/;

function parseDateOnlyToUtc(dateString: string): Date | null {
  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(dateString);
  if (!dateOnlyMatch) {
    return null;
  }

  const year = Number.parseInt(dateOnlyMatch[1] ?? '', 10);
  const month = Number.parseInt(dateOnlyMatch[2] ?? '', 10);
  const day = Number.parseInt(dateOnlyMatch[3] ?? '', 10);

  // coverage-ignore-next-line -- the regex only captures digits; this is a defensive parse guard.
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null; // coverage-ignore-line
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseTimestampWithoutTimezoneToUtc(dateString: string): Date | null {
  if (!TIMESTAMP_WITHOUT_TIMEZONE_PATTERN.test(dateString)) {
    return null;
  }

  const date = new Date(`${dateString}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasInvalidIsoDatePrefix(dateString: string): boolean {
  const match = ISO_DATE_PREFIX_PATTERN.exec(dateString);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  return parseDateOnlyToUtc(`${year}-${month}-${day}`) === null;
}

/**
 * Parses either a strict date-only value (YYYY-MM-DD) in UTC, or a full ISO timestamp.
 */
export function parseStatusDate(dateString: string): Date | null {
  if (hasInvalidIsoDatePrefix(dateString)) {
    return null;
  }

  const dateOnly = parseDateOnlyToUtc(dateString);
  if (dateOnly) {
    return dateOnly;
  }

  const timestampWithoutTimezone = parseTimestampWithoutTimezoneToUtc(dateString);
  if (timestampWithoutTimezone) {
    return timestampWithoutTimezone;
  }

  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? null : date;
}
