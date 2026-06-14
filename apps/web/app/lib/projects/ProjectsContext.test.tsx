import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ApiClientError } from '@taskforceai/contracts/client';
import '../../../../../tests/setup/dom';

let currentUser: { id: number; email: string } | null = { id: 1, email: 'test@example.com' };
let authState = {
  isAuthenticated: true,
  isLoading: false,
  isTokenReady: true,
};

const mockUseAuth = vi.fn(() => ({
  user: currentUser,
  ...authState,
}));
vi.mock('../providers/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

const mockFetchProjects = vi.fn();
const mockCreateNewProject = vi.fn();
const mockDeleteUserProject = vi.fn();

vi.mock('./project-service', () => ({
  fetchProjects: (...args: unknown[]) => mockFetchProjects(...args),
  createNewProject: (...args: unknown[]) => mockCreateNewProject(...args),
  deleteUserProject: (...args: unknown[]) => mockDeleteUserProject(...args),
}));

import { ProjectsProvider, useProjects } from './ProjectsContext';

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const TestComponent = () => {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    isLoading,
    isModalOpen,
    setModalOpen,
    refreshProjects,
    createProject,
    deleteProject,
  } = useProjects();
  return (
    <div>
      <span data-testid="loading">{isLoading ? 'loading' : 'not-loading'}</span>
      <span data-testid="projects-count">{projects.length}</span>
      <span data-testid="active-project">{activeProjectId ?? 'none'}</span>
      <span data-testid="modal-open">{isModalOpen ? 'open' : 'closed'}</span>
      <button onClick={() => setModalOpen(true)}>Open Modal</button>
      <button onClick={() => setActiveProjectId(7)}>Set Active</button>
      <button onClick={() => void refreshProjects()}>Refresh</button>
      <button onClick={() => void createProject('Created', 'Desc', 'Instructions')}>
        Create Project
      </button>
      <button onClick={() => void deleteProject(7)}>Delete Project</button>
    </div>
  );
};

describe('ProjectsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: 1, email: 'test@example.com' };
    authState = {
      isAuthenticated: true,
      isLoading: false,
      isTokenReady: true,
    };
    mockFetchProjects.mockResolvedValue({ ok: true, value: [] });
  });

  it('provides initial state', async () => {
    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );
    // Wait for initial load to complete to avoid act warnings
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    expect(screen.getByTestId('projects-count')).toHaveTextContent('0');
  });

  it('loads projects on mount', async () => {
    mockFetchProjects.mockResolvedValue({
      ok: true,
      value: [{ id: 1, name: 'Test Project' }],
    });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('projects-count')).toHaveTextContent('1');
    });
  });

  it('waits for auth token readiness before loading projects', async () => {
    authState = {
      isAuthenticated: true,
      isLoading: false,
      isTokenReady: false,
    };

    const { rerender } = render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetchProjects).not.toHaveBeenCalled();

    authState = {
      isAuthenticated: true,
      isLoading: false,
      isTokenReady: true,
    };
    rerender(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => {
      expect(mockFetchProjects).toHaveBeenCalledTimes(1);
    });
  });

  it('handles setModalOpen', async () => {
    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));

    expect(screen.getByTestId('modal-open')).toHaveTextContent('closed');
    fireEvent.click(screen.getByText('Open Modal'));
    expect(screen.getByTestId('modal-open')).toHaveTextContent('open');
  });

  it('creates projects and refreshes after success', async () => {
    mockCreateNewProject.mockResolvedValue({
      ok: true,
      value: { id: 3, name: 'Created' },
    });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    fireEvent.click(screen.getByText('Create Project'));

    await waitFor(() => {
      expect(mockCreateNewProject).toHaveBeenCalledWith({
        name: 'Created',
        description: 'Desc',
        custom_instructions: 'Instructions',
      });
      expect(mockFetchProjects).toHaveBeenCalledTimes(2);
    });
  });

  it('returns null when creating a project fails', async () => {
    mockCreateNewProject.mockResolvedValue({ ok: false, error: new Error('nope') });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    fireEvent.click(screen.getByText('Create Project'));

    await waitFor(() => expect(mockCreateNewProject).toHaveBeenCalled());
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
  });

  it('deletes projects and clears the active project when needed', async () => {
    mockDeleteUserProject.mockResolvedValue({ ok: true, value: undefined });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    fireEvent.click(screen.getByText('Set Active'));
    expect(screen.getByTestId('active-project')).toHaveTextContent('7');

    fireEvent.click(screen.getByText('Delete Project'));

    await waitFor(() => {
      expect(mockDeleteUserProject).toHaveBeenCalledWith(7);
      expect(screen.getByTestId('active-project')).toHaveTextContent('none');
      expect(mockFetchProjects).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps state when deleting a project fails', async () => {
    mockDeleteUserProject.mockResolvedValue({ ok: false, error: new Error('nope') });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    fireEvent.click(screen.getByText('Set Active'));
    fireEvent.click(screen.getByText('Delete Project'));

    await waitFor(() => expect(mockDeleteUserProject).toHaveBeenCalledWith(7));
    expect(screen.getByTestId('active-project')).toHaveTextContent('7');
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
  });

  it('skips refresh while rate limited', async () => {
    mockFetchProjects.mockResolvedValue({
      ok: false,
      error: new ApiClientError(429, { message: 'Rate limited' }),
    });

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Refresh'));
    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
  });

  it('clears projects when user is null', async () => {
    currentUser = null;

    render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    // Should load 0 projects
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));
    expect(screen.getByTestId('projects-count')).toHaveTextContent('0');
  });

  it('ignores stale project responses after logout', async () => {
    const pending = createDeferred<{ ok: true; value: Array<{ id: number; name: string }> }>();
    mockFetchProjects.mockReturnValueOnce(pending.promise);

    const { rerender } = render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('loading'));

    currentUser = null;
    rerender(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('not-loading'));

    pending.resolve({ ok: true, value: [{ id: 99, name: 'Stale Project' }] });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('projects-count')).toHaveTextContent('0');
  });

  it('resets 429 cooldown when the authenticated user changes', async () => {
    mockFetchProjects
      .mockResolvedValueOnce({
        ok: false,
        error: new ApiClientError(429, { message: 'Rate limited' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: 2, name: 'Second User Project' }],
      });

    const { rerender } = render(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => {
      expect(mockFetchProjects).toHaveBeenCalledTimes(1);
    });

    currentUser = { id: 2, email: 'second@example.com' };
    rerender(
      <ProjectsProvider>
        <TestComponent />
      </ProjectsProvider>
    );

    await waitFor(() => {
      expect(mockFetchProjects).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('projects-count')).toHaveTextContent('1');
    });
  });
});
