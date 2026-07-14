import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const navigate = vi.fn();
const setActiveProjectId = vi.fn();
const setModalOpen = vi.fn();

vi.mock('../routing', () => ({
  useRouter: () => ({ navigate }),
}));

vi.mock('../../lib/providers/AuthProvider', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock('../../lib/projects/ProjectsContext', () => ({
  useProjects: () => ({
    projects: [
      {
        id: 1,
        name: 'Launch plan',
        description: 'Prepare the release',
        created_at: '2026-07-12T12:00:00Z',
      },
      {
        id: 2,
        name: 'Research',
        description: 'Explore model options',
        created_at: '2026-07-12T12:00:00Z',
      },
    ],
    isLoading: false,
    setActiveProjectId,
    setModalOpen,
  }),
}));

import { filterProjects, ProjectsPage } from './ProjectsPage';

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('searches projects and opens project creation', () => {
    expect(
      filterProjects(
        [
          {
            id: 1,
            name: 'Launch plan',
            description: 'Prepare the release',
            created_at: '2026-07-12T12:00:00Z',
            updated_at: '2026-07-12T12:00:00Z',
          },
          {
            id: 2,
            name: 'Research',
            description: 'Explore model options',
            created_at: '2026-07-12T12:00:00Z',
            updated_at: '2026-07-12T12:00:00Z',
          },
        ],
        'research'
      ).map((project) => project.name)
    ).toEqual(['Research']);

    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(setModalOpen).toHaveBeenCalledWith(true);
  });

  it('selects a project without advertising unsupported sharing filters', () => {
    render(<ProjectsPage />);

    fireEvent.click(screen.getByRole('button', { name: /Launch plan/ }));
    expect(setActiveProjectId).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledWith({ to: '/' });

    expect(screen.queryByRole('button', { name: 'Shared with you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Created by you' })).toBeNull();
  });
});
