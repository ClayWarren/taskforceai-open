import { createFileRoute } from '@tanstack/react-router';

import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import { PluginsPage } from '../components/plugins/PluginsPage';

export const Route = createFileRoute('/plugins')({
  component: PluginsRoute,
});

function PluginsRoute() {
  return (
    <StandaloneRouteShell>
      <PluginsPage />
    </StandaloneRouteShell>
  );
}
