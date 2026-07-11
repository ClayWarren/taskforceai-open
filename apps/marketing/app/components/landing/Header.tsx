import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { BrandMark, HeaderLink, SimpleBrandMark } from './BrandMark';
import { ThemeToggle } from './ThemeToggle';
import type { NavigationLink } from './types';
import { splitInternalRouterHref } from '@/lib/router-links';

const mobileNavigationLinkClassName =
  'block cursor-pointer px-4 py-3 text-slate-800 no-underline hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-white/5 dark:hover:text-white';

function MobileNavigationLink({ link, onSelect }: { link: NavigationLink; onSelect: () => void }) {
  const routerHref = splitInternalRouterHref(link.href);

  if (!routerHref) {
    return (
      <a
        href={link.href}
        onClick={onSelect}
        className={mobileNavigationLinkClassName}
        role="menuitem"
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link
      to={routerHref.to}
      hash={routerHref.hash}
      onClick={onSelect}
      className={mobileNavigationLinkClassName}
      role="menuitem"
    >
      {link.label}
    </Link>
  );
}

export function Header({ navigationLinks }: { navigationLinks: NavigationLink[] }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <header className="relative w-full px-4 py-3 md:px-6 md:py-4">
      <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <div className="flex w-full items-center justify-between lg:hidden">
          <SimpleBrandMark />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-900 transition hover:bg-slate-900/10 focus:ring-2 focus:ring-blue-400/70 focus:ring-offset-2 focus:ring-offset-white focus:outline-none dark:border-white/10 dark:text-white dark:hover:bg-white/10 dark:focus:ring-offset-slate-950"
                aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              >
                {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </Dialog.Trigger>
          </div>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in" />
          <Dialog.Content
            className="fixed inset-x-4 top-20 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl shadow-blue-500/10 backdrop-blur data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-4 dark:border-white/10 dark:bg-slate-900/95"
            role="menu"
            aria-label="Primary navigation"
          >
            <Dialog.Title className="sr-only">Primary navigation menu</Dialog.Title>
            <Dialog.Description className="sr-only">
              Navigation links for primary site sections
            </Dialog.Description>
            <nav>
              <ul className="flex flex-col divide-y divide-slate-200 text-sm font-medium dark:divide-white/10">
                {navigationLinks.map((link) => (
                  <li key={link.href}>
                    <MobileNavigationLink link={link} onSelect={closeMobileNav} />
                  </li>
                ))}
              </ul>
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="hidden w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center lg:grid">
        <div className="col-start-2 flex items-center gap-10">
          <BrandMark />
          <nav aria-label="Primary navigation">
            <ul className="flex items-center gap-6 text-sm font-medium">
              {navigationLinks.map((link) => (
                <li key={link.href}>
                  <HeaderLink href={link.href}>{link.label}</HeaderLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <ThemeToggle className="col-start-3 justify-self-end" />
      </div>
    </header>
  );
}
