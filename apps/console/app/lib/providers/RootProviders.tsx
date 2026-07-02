import { QueryProvider } from '@taskforceai/ui-kit/QueryProvider';
import { type ReactNode } from 'react';

import { TooltipProvider } from '../../components/ui/tooltip';
import { AuthProvider } from './AuthProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
