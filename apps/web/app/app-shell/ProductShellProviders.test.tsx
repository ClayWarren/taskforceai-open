import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type React from 'react';

import '../../../../tests/setup/dom';

vi.mock('../components/projects/ProjectModal', () => ({
  default: () => <div data-testid="project-modal" />,
}));

vi.mock('../lib/profile/ProfileModalContext', () => ({
  ProfileModalProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="profile-modal-provider">{children}</div>
  ),
}));

vi.mock('../lib/projects/ProjectsContext', () => ({
  ProjectsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="projects-provider">{children}</div>
  ),
}));

const { ProductShellProviders } = await import('./ProductShellProviders');

describe('ProductShellProviders', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps children in profile and project providers and mounts the project modal', () => {
    render(
      <ProductShellProviders>
        <main>Product shell child</main>
      </ProductShellProviders>
    );

    expect(screen.getByTestId('profile-modal-provider')).toContainElement(
      screen.getByTestId('projects-provider')
    );
    expect(screen.getByTestId('projects-provider')).toContainElement(
      screen.getByText('Product shell child')
    );
    expect(screen.getByTestId('projects-provider')).toContainElement(
      screen.getByTestId('project-modal')
    );
  });
});
