import clsx from 'clsx';
import { Link } from '@tanstack/react-router';
import { type MouseEventHandler, type ReactNode } from 'react';

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
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950';

  // Colors/borders/backgrounds are driven by the theme-aware `variants` classes
  // below; inline styles only carry shape, spacing, weight, and shadow so the
  // light/dark toggle can take effect.
  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      boxShadow: '0 15px 35px rgba(37, 99, 235, 0.35)',
      fontWeight: 600,
    },
    secondary: { fontWeight: 500 },
    ghost: { fontWeight: 500 },
    outline: { fontWeight: 500 },
    link: {
      padding: '0',
      textDecoration: 'none',
      fontWeight: 500,
    },
    light: { fontWeight: 500 },
    dark: { fontWeight: 500 },
  };

  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: { padding: '0.5rem 1rem', fontSize: '0.875rem', borderRadius: '0.5rem' },
    md: { padding: '0.625rem 1.25rem', fontSize: '0.875rem', borderRadius: '0.5rem' },
    lg: { padding: '0.75rem 1.5rem', fontSize: '0.9375rem', borderRadius: '0.5rem' },
  };

  const resolvedVariant: ButtonVariant = variant ?? 'primary';
  const resolvedSize: ButtonSize = size ?? 'md';

  const combinedStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    borderRadius: '0.5rem',
    fontWeight: 500,
    transition: 'all 0.15s ease',
    cursor: 'pointer',
    textDecoration: 'none',
    ...variantStyles[resolvedVariant],
    ...(resolvedVariant !== 'link' ? sizeStyles[resolvedSize] : {}),
    ...style,
  } satisfies React.CSSProperties;

  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/50 border border-blue-400',
    secondary:
      'bg-white/70 dark:bg-slate-900/70 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-slate-300 dark:border-white/25 shadow-blue-500/10',
    ghost:
      'text-slate-900 dark:text-slate-100 hover:text-slate-900 dark:hover:text-white hover:bg-slate-900/10 dark:hover:bg-white/10 border border-transparent hover:border-slate-300 dark:hover:border-white/20',
    outline:
      'border-2 border-slate-300 dark:border-white/30 text-slate-900 dark:text-white hover:border-slate-300 dark:hover:border-white/50 hover:bg-slate-900/10 dark:hover:bg-white/10 bg-transparent',
    link: 'text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200 font-semibold px-0 py-0 underline',
    light:
      'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700 shadow-lg shadow-slate-900/60 border border-slate-300 dark:border-white/20',
    dark: 'bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border-2 border-slate-300 dark:border-white/30 shadow-lg',
  };

  const sizes: Record<ButtonSize, string> = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const className = clsx(
    base,
    variants[resolvedVariant] || '',
    resolvedVariant === 'link' ? 'px-0 py-0 text-sm' : sizes[resolvedSize],
    {
      'shadow-none': resolvedVariant === 'ghost' || resolvedVariant === 'link',
    }
  );

  const handleAnchorClick: MouseEventHandler<HTMLAnchorElement> | undefined = onClick
    ? () => {
        onClick();
      }
    : undefined;

  const linkProps = handleAnchorClick ? { onClick: handleAnchorClick } : {};

  // Routes that exist in the web app, not marketing - need full page navigation
  const webAppRoutes = ['/login', '/signup', '/register', '/', '/settings', '/console'];
  const isWebAppRoute = webAppRoutes.some(
    (route) => href === route || href.startsWith(`${route}/`)
  );

  if (external || isWebAppRoute) {
    return (
      <a
        href={href}
        {...linkProps}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={className}
        style={combinedStyle}
      >
        {children}
        {icon}
      </a>
    );
  }

  return (
    <Link to={href} className={className} style={combinedStyle} preload={false} {...linkProps}>
      {children}
      {icon}
    </Link>
  );
}
