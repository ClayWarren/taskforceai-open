import { createFileRoute } from '@tanstack/react-router';

import { ProductShellProviders } from '../app-shell/ProductShellProviders';
import { FinancePage } from '../components/finance/FinancePage';
import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';

export const Route = createFileRoute('/finance')({
  component: FinanceRoute,
});

function FinanceRoute() {
  return (
    <ProductShellProviders>
      <StandaloneRouteShell>
        <FinancePage />
      </StandaloneRouteShell>
    </ProductShellProviders>
  );
}
