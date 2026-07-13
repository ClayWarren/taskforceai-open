import { createFileRoute } from '@tanstack/react-router';

import { ProductShellProviders } from '../app-shell/ProductShellProviders';
import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import { ProjectsPage } from '../components/projects/ProjectsPage';

export const Route = createFileRoute('/projects')({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  return (
    <ProductShellProviders>
      <StandaloneRouteShell>
        <ProjectsPage />
      </StandaloneRouteShell>
    </ProductShellProviders>
  );
}
