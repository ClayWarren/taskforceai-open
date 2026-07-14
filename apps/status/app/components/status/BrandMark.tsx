import { type ReactNode } from 'react';

const rssUrl = import.meta.env.VITE_STATUS_RSS_URL;

export function BrandMark({ subtitle }: { subtitle?: ReactNode }) {
  return (
    <a href="https://taskforceai.chat" className="flex min-w-0 items-center gap-3">
      <div className="relative h-10 w-10 shrink-0">
        <img src="/favicon-32x32.png" alt="TaskForceAI" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0">
        <p
          className="truncate font-semibold tracking-[0.26em] text-foreground uppercase"
          style={{ fontSize: '0.9rem' }}
        >
          TaskForceAI
        </p>
        {subtitle ?? (
          <p className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
            System Status
          </p>
        )}
      </div>
    </a>
  );
}

export function SimpleBrandMark() {
  return (
    <a href="https://taskforceai.chat" className="flex items-center gap-2">
      <div className="relative h-8 w-8 shrink-0">
        <img src="/favicon-32x32.png" alt="TaskForceAI" className="h-full w-full object-contain" />
      </div>
      <p
        className="text-sm font-semibold tracking-[0.26em] text-foreground uppercase"
        style={{ fontSize: '0.875rem' }}
      >
        TaskForceAI
      </p>
    </a>
  );
}

export function StatusHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/50 backdrop-blur-md">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
        <BrandMark />
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
          {rssUrl && (
            <a
              href={rssUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Subscribe to incident updates via RSS"
              className="flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:h-auto sm:w-auto sm:gap-1.5"
              title="Subscribe to incident updates via RSS"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M3.75 3a.75.75 0 0 0-.75.75v.5c0 .414.336.75.75.75H4c6.075 0 11 4.925 11 11v.25c0 .414.336.75.75.75h.5a.75.75 0 0 0 .75-.75V16C17 8.82 11.18 3 4 3h-.25Z" />
                <path d="M3 8.75a.75.75 0 0 1 .75-.75H4a8 8 0 0 1 8 8v.25a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V16a6 6 0 0 0-6-6h-.25A.75.75 0 0 1 3 9.25v-.5ZM7 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
              </svg>
              <span className="hidden sm:inline">Subscribe</span>
            </a>
          )}
          <a
            href="https://x.com/taskforceai_us"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Follow Updates
          </a>
          <a
            href="https://taskforceai.chat"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <span className="sm:hidden">App</span>
            <span className="hidden sm:inline">Back to App</span>
          </a>
        </div>
      </div>
    </header>
  );
}
