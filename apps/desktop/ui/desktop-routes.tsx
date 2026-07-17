import { Outlet } from '@tanstack/react-router';
import { ErrorBoundary } from '@taskforceai/ui-kit/ErrorBoundary';
import { useEffect } from 'react';

import { ProductShellProviders } from '@taskforceai/web/app/app-shell/ProductShellProviders';
import { StandaloneRouteShell } from '@taskforceai/web/app/app-shell/StandaloneRouteShell';
import { PluginsPage } from '@taskforceai/web/app/components/plugins/PluginsPage';
import { Providers } from '@taskforceai/web/app/lib/providers/RootProviders';
import { DesktopWindowDragRegion } from './app-shell/DesktopWindowDragRegion';
import { TauriReadySignal } from './platform/TauriReadySignal';

export function DesktopRoot() {
  return (
    <>
      <DesktopWindowDragRegion />
      <TauriReadySignal />
      <ErrorBoundary>
        <Providers>
          <ProductShellProviders>
            <Outlet />
          </ProductShellProviders>
        </Providers>
      </ErrorBoundary>
    </>
  );
}

export function DesktopAuthRedirectRecovery() {
  useEffect(() => {
    window.location.replace('/');
  }, []);

  return null;
}

export function DesktopPluginsRoute() {
  return (
    <StandaloneRouteShell>
      <PluginsPage />
    </StandaloneRouteShell>
  );
}
