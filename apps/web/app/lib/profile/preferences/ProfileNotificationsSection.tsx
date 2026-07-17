'use client';

import { ChevronDown } from 'lucide-react';

export function NotificationsSection(props: {
  enabled: boolean;
  onToggle: (_enabled: boolean) => void;
}) {
  const notificationRows = [
    {
      id: 'taskforceai',
      title: 'TaskForceAI',
      description: 'Get notified about TaskForceAI task activity.',
    },
    {
      id: 'responses',
      title: 'Responses',
      description: 'Get notified when TaskForceAI responds to requests.',
    },
    {
      id: 'tasks',
      title: 'Tasks',
      description: "Get notified when tasks you've created have updates.",
    },
    {
      id: 'projects',
      title: 'Projects',
      description: 'Get notified when you receive an invitation to a shared project.',
    },
    {
      id: 'usage',
      title: 'Usage',
      description: "We'll notify you when request or credit limits reset.",
    },
  ] as const;

  return (
    <div className="divide-y divide-border border-y border-border">
      {notificationRows.map((row) => (
        <div key={row.id} className="flex items-start justify-between gap-4 py-5">
          <div className="min-w-0 flex-1 text-left">
            <label
              className="block text-base font-medium text-foreground"
              htmlFor={`notification-${row.id}`}
            >
              {row.title}
            </label>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {row.description}
            </p>
          </div>
          <div className="relative shrink-0">
            <select
              id={`notification-${row.id}`}
              aria-label={`${row.title} notification delivery`}
              className="appearance-none bg-transparent py-0.5 pr-7 pl-1 text-right text-base font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={props.enabled ? 'push' : 'off'}
              onChange={(event) => props.onToggle(event.currentTarget.value === 'push')}
            >
              <option value="push">Push</option>
              <option value="off">Off</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2 text-foreground"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
