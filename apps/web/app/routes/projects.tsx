import { createFileRoute } from '@tanstack/react-router';

import { StandaloneRouteShell } from '../app-shell/StandaloneRouteShell';
import { ProjectsPage } from '../components/projects/ProjectsPage';

export const Route = createFileRoute('/projects')({
  component: ProjectsRoute,
});

export function ProjectsRoute() {
  return (
    <StandaloneRouteShell>
      <ProjectsPage />
    </StandaloneRouteShell>
  );
}
