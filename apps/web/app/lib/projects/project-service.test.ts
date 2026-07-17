import { describe, expect, it, vi, type Mock } from 'bun:test';

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('mock-csrf-token'),
  withCsrf: vi.fn(async (init: RequestInit = {}) => init),
}));

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: vi.fn(() => ({
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue({ id: 1, name: 'Updated' }),
  })),
}));

import {
  fetchProjects,
  createNewProject,
  deleteUserProject,
  updateUserProject,
} from './project-service';

describe('project-service', () => {
  describe('fetchProjects', () => {
    it('returns projects on success', async () => {
      const mockProjects = [
        { id: 1, name: 'Project 1', created_at: new Date().toISOString() },
        { id: 2, name: 'Project 2', created_at: new Date().toISOString() },
      ];

      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn().mockResolvedValue(mockProjects),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
      } as any);

      const result = await fetchProjects();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockProjects as any);
      }
    });

    it('returns error on failure', async () => {
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn().mockRejectedValue(new Error('Network error')),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
      } as any);

      const result = await fetchProjects();
      expect(result.ok).toBe(false);
    });
  });

  describe('createNewProject', () => {
    it('returns project on success', async () => {
      const mockProject = { id: 1, name: 'New Project', created_at: new Date().toISOString() };

      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn(),
        createProject: vi.fn().mockResolvedValue(mockProject),
        deleteProject: vi.fn(),
      } as any);

      const result = await createNewProject({ name: 'New Project' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockProject as any);
      }
    });

    it('returns error on failure', async () => {
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn(),
        createProject: vi.fn().mockRejectedValue(new Error('Failed')),
        deleteProject: vi.fn(),
      } as any);

      const result = await createNewProject({ name: 'New Project' });
      expect(result.ok).toBe(false);
    });
  });

  describe('deleteUserProject', () => {
    it('returns true on success', async () => {
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn().mockResolvedValue(undefined),
      } as any);

      const result = await deleteUserProject(1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns error on failure', async () => {
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn().mockRejectedValue(new Error('Failed')),
      } as any);

      const result = await deleteUserProject(1);
      expect(result.ok).toBe(false);
    });
  });

  describe('updateUserProject', () => {
    it('returns the updated project on success', async () => {
      const updatedAt = new Date().toISOString();
      const updatedProject = {
        id: 1,
        name: 'Updated',
        created_at: updatedAt,
        updated_at: updatedAt,
      };
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      const updateProject = vi.fn().mockResolvedValue(updatedProject);
      (getBrowserClient as Mock<any>).mockReturnValue({ updateProject } as any);

      const result = await updateUserProject(1, { name: 'Updated' });

      expect(updateProject).toHaveBeenCalledWith(1, { name: 'Updated' });
      expect(result).toEqual({ ok: true, value: updatedProject });
    });

    it('returns an error when the update fails', async () => {
      const { getBrowserClient } = await import('@taskforceai/api-client/browserClient');
      (getBrowserClient as Mock<any>).mockReturnValue({
        updateProject: vi.fn().mockRejectedValue(new Error('Failed')),
      } as any);

      const result = await updateUserProject(1, { name: 'Updated' });

      expect(result.ok).toBe(false);
    });
  });
});
