import { Image } from '@unpic/react';
import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { splitInternalRouterHref } from '@/lib/router-links';

export function BrandMark({ subtitle }: { subtitle?: ReactNode }) {
  return (
    <Link to="/" className="flex items-center gap-3">
      <div className="relative h-12 w-12 shrink-0">
        <Image
          src="/icon-48.webp"
          alt="TaskForceAI"
          width={48}
          height={48}
          fetchPriority="high"
          className="object-contain"
        />
      </div>
      <div>
        <p
          className="font-semibold tracking-[0.26em] text-slate-900 uppercase dark:text-white"
          style={{ fontSize: '1rem', letterSpacing: '0.05em' }}
        >
          TaskForceAI
        </p>
        {subtitle ?? (
          <p className="text-slate-600 dark:text-slate-400" style={{ fontSize: '0.8125rem' }}>
            Multi-agent orchestration platform
          </p>
        )}
      </div>
    </Link>
  );
}

export function SimpleBrandMark() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <div className="relative h-8 w-8 shrink-0">
        <Image
          src="/icon-48.webp"
          alt="TaskForceAI"
          width={32}
          height={32}
          fetchPriority="high"
          className="object-contain"
        />
      </div>
      <p
        className="text-sm font-semibold tracking-[0.26em] text-slate-900 uppercase dark:text-white"
        style={{ fontSize: '0.875rem', letterSpacing: '0.05em' }}
      >
        TaskForceAI
      </p>
    </Link>
  );
}

export function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  const routerHref = splitInternalRouterHref(href);

  if (!routerHref) {
    return (
      <a
        href={href}
        className="cursor-pointer font-medium text-slate-700 no-underline transition hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      to={routerHref.to}
      hash={routerHref.hash}
      className="cursor-pointer font-medium text-slate-700 no-underline transition hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
    >
      {children}
    </Link>
  );
}
