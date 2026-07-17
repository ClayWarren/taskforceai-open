'use client';

import type { ReactNode } from 'react';

import ProjectModal from '../components/projects/ProjectModal';
import { ProfileModalProvider } from '../lib/profile/modal/ProfileModalContext';
import { ProjectsProvider } from '../lib/projects/ProjectsContext';

interface ProductShellProvidersProps {
  children: ReactNode;
}

export function ProductShellProviders({ children }: ProductShellProvidersProps) {
  return (
    <ProfileModalProvider>
      <ProjectsProvider>
        {children}
        <ProjectModal />
      </ProjectsProvider>
    </ProfileModalProvider>
  );
}
