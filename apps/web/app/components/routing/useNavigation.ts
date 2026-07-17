'use client';

/**
 * Routing abstraction - Navigation hooks
 *
 * Now uses @tanstack/react-router equivalents.
 */
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

// Provide a framework-compatible router interface with TanStack navigate
export const useRouter = () => {
  const navigate = useNavigate();
  return {
    push: (to: string) => navigate({ to }),
    replace: (to: string) => navigate({ to, replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    // Also expose navigate for components that use TanStack-style navigation
    navigate: (opts: any) => navigate(opts),
  };
};

// Wrap useLocation to return just the pathname
export const usePathname = () => {
  const location = useLocation();
  return location.pathname;
};

// Wrap useSearch to return URLSearchParams for compatibility
export const useSearchParams = () => {
  const search = useSearch({ strict: false });
  return useMemo(() => {
    const cleanSearch: Record<string, string> = {};
    if (search && typeof search === 'object') {
      Object.entries(search).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          cleanSearch[key] = String(value);
        }
      });
    }
    return new URLSearchParams(cleanSearch);
  }, [search]);
};
