import { sortedCopy } from '@taskforceai/client-core';

import { Badge } from '@taskforceai/ui-kit/badge';
import type { Incident, ServiceStatus } from '@taskforceai/contracts/api/status';
import { parseStatusDate } from './date-utils';

interface IncidentHistoryProps {
  incidents: Incident[];
}

const getStatusColor = (status: ServiceStatus) => {
  switch (status) {
    case 'operational':
      return 'bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400';
    case 'degraded':
      return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400';
    case 'outage':
      return 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400';
    case 'maintenance':
      return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400';
    default:
      return 'bg-gray-500/10 text-gray-700 border-gray-500/20 dark:text-gray-400';
  }
};

function getIncidentDayKey(dateString: string): string {
  const date = parseStatusDate(dateString);
  if (!date) {
    return 'invalid';
  }

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function formatIncidentDateUtc(
  dateString: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string | string[]
): string {
  const date = parseStatusDate(dateString);
  if (!date) {
    return 'Invalid Date';
  }

  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: 'UTC',
  }).format(date);
}

export function formatIncidentTimestampUtc(
  dateString: string,
  locale: string | string[] = 'en-US'
): string {
  const date = parseStatusDate(dateString);
  if (!date) {
    return 'Invalid Date';
  }

  const parts = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).formatToParts(date);

  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';

  return `${month} ${day}, ${hour}:${minute}`;
}

export function IncidentHistory({ incidents }: IncidentHistoryProps) {
  if (incidents.length === 0) {
    return (
      <div className="mt-12">
        <h2 className="mb-6 text-2xl font-bold">Past Incidents</h2>
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No incidents reported in the last 14 days.
        </div>
      </div>
    );
  }

  // Group incidents by date
  const groupedIncidents = incidents.reduce(
    (groups, incident) => {
      const dayKey = getIncidentDayKey(incident.createdAt);
      if (!groups[dayKey]) {
        groups[dayKey] = [];
      }
      groups[dayKey].push(incident);
      return groups;
    },
    {} as Record<string, Incident[]>
  );

  const sortedDateEntries = sortedCopy(Object.entries(groupedIncidents), ([dayKeyA], [dayKeyB]) => {
    if (dayKeyA === 'invalid') return 1;
    if (dayKeyB === 'invalid') return -1;
    return dayKeyB.localeCompare(dayKeyA);
  });

  return (
    <div className="mt-12">
      <h2 className="mb-6 text-2xl font-bold">Past Incidents</h2>
      <div className="space-y-10">
        {sortedDateEntries.map(([dayKey, dateIncidents]) => (
          <div key={dayKey} className="relative">
            <h3 className="mb-4 border-b pb-2 text-lg font-semibold">
              {dayKey === 'invalid'
                ? 'Invalid Date'
                : formatIncidentDateUtc(dayKey, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
            </h3>
            <div className="space-y-8">
              {dateIncidents.map((incident) => (
                <div key={incident.id} className="ml-2">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="text-xl font-bold text-foreground">{incident.title}</h4>
                    <Badge variant="outline" className={getStatusColor(incident.status)}>
                      {incident.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-6">
                    {incident.updates.map((update) => (
                      <div
                        key={update.id}
                        className="relative pl-6 before:absolute before:top-2 before:left-0 before:h-full before:w-[1px] before:bg-border last:before:h-4"
                      >
                        <div className="absolute top-2 left-[-4px] h-2 w-2 rounded-full bg-muted-foreground/30" />
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-foreground">{update.message}</p>
                          <span className="text-xs text-muted-foreground">
                            {formatIncidentTimestampUtc(update.createdAt)} UTC
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
