import { createFileRoute } from '@tanstack/react-router';

import { ProductShellProviders } from '../app-shell/ProductShellProviders';
import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import { PluginsPage } from '../components/plugins/PluginsPage';

export const Route = createFileRoute('/plugins')({
  component: PluginsRoute,
});

function PluginsRoute() {
  return (
    <ProductShellProviders>
      <StandaloneRouteShell>
        <PluginsPage />
      </StandaloneRouteShell>
    </ProductShellProviders>
  );
}
