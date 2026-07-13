import { QueryProvider } from '@taskforceai/ui-kit/QueryProvider';
import { type ReactNode } from 'react';

import { TooltipProvider } from '@taskforceai/ui-kit/tooltip';
import { AuthProvider } from '@taskforceai/ui-kit/auth/AuthProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
