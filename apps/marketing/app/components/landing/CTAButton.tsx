import clsx from 'clsx';
import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { splitInternalRouterHref } from '@/lib/router-links';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'link'
  | 'light'
  | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type CTAButtonProps = {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  external?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
};

export function CTAButton({
  href,
  children,
  variant,
  size,
  icon,
  external,
  style,
  onClick,
}: CTAButtonProps) {
  const base =
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg no-underline transition-all duration-150 ease-[ease] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950';

  const resolvedVariant: ButtonVariant = variant ?? 'primary';
  const resolvedSize: ButtonSize = size ?? 'md';

  const variants: Record<ButtonVariant, string> = {
    primary:
      'border border-blue-400 bg-blue-600 text-white [box-shadow:0_15px_35px_rgba(37,99,235,0.35)] hover:bg-blue-500',
    secondary:
      'bg-white/70 dark:bg-slate-900/70 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-300 dark:border-white/25 shadow-blue-500/10',
    ghost:
      'text-slate-900 dark:text-slate-100 hover:text-slate-900 dark:hover:text-white hover:bg-slate-900/10 dark:hover:bg-white/10 border border-transparent hover:border-slate-300 dark:hover:border-white/20',
    outline:
      'border-2 border-slate-300 dark:border-white/30 text-slate-900 dark:text-white hover:border-slate-300 dark:hover:border-white/50 hover:bg-slate-900/10 dark:hover:bg-white/10 bg-transparent',
    link: 'px-0 py-0 text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200',
    light:
      'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700 shadow-lg shadow-slate-900/60 border border-slate-300 dark:border-white/20',
    dark: 'bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border-2 border-slate-300 dark:border-white/30 shadow-lg',
  };

  const sizes: Record<ButtonSize, string> = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-[0.9375rem]',
  };

  const className = clsx(
    base,
    variants[resolvedVariant],
    resolvedVariant === 'link' ? 'px-0 py-0 text-sm' : sizes[resolvedSize],
    resolvedVariant === 'primary' ? 'font-semibold' : 'font-medium',
    {
      'shadow-none': resolvedVariant === 'ghost' || resolvedVariant === 'link',
    }
  );

  // Routes that exist in the web app, not marketing - need full page navigation
  const webAppRoutes = ['/login', '/signup', '/register', '/', '/settings', '/console'];
  const isWebAppRoute = webAppRoutes.some(
    (route) => href === route || href.startsWith(`${route}/`)
  );
  const routerHref = external || isWebAppRoute ? null : splitInternalRouterHref(href);

  if (!routerHref) {
    return (
      <a
        href={href}
        onClick={onClick}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={className}
        style={style}
      >
        {children}
        {icon}
      </a>
    );
  }

  return (
    <Link
      to={routerHref.to}
      hash={routerHref.hash}
      className={className}
      style={style}
      preload={false}
      onClick={onClick}
    >
      {children}
      {icon}
    </Link>
  );
}
