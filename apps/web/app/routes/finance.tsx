import { createFileRoute } from '@tanstack/react-router';

import { FinancePage } from '../components/finance/FinancePage';
import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';

export const Route = createFileRoute('/finance')({
  component: FinanceRoute,
});

function FinanceRoute() {
  return (
    <StandaloneRouteShell>
      <FinancePage />
    </StandaloneRouteShell>
  );
}
