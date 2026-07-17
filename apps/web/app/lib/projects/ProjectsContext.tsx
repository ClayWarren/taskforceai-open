'use client';

import type { Project } from '@taskforceai/contracts/contracts';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchProjects,
  createNewProject,
  deleteUserProject,
  updateUserProject,
} from './project-service';
import { useAuth } from '../providers/AuthProvider';
import { ApiClientError } from '@taskforceai/api-client/client';

const RATE_LIMIT_COOLDOWN_MS = 60_000;

interface ProjectsContextType {
  projects: Project[];
  activeProjectId: number | null;
  setActiveProjectId: (_id: number | null) => void;
  isLoading: boolean;
  isModalOpen: boolean;
  setModalOpen: (_open: boolean) => void;
  refreshProjects: () => Promise<void>;
  upsertProject: (_project: Project) => void;
  createProject: (
    _name: string,
    _description?: string,
    _instructions?: string
  ) => Promise<Project | null>;
  deleteProject: (_id: number) => Promise<boolean>;
  renameProject: (_id: number, _name: string) => Promise<boolean>;
}

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

export const ProjectsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading: isAuthLoading, isTokenReady, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setModalOpen] = useState(false);
  const rateLimitedUntilRef = useRef<number>(0);
  const refreshGenerationRef = useRef(0);
  const canFetchProjects = Boolean(user && isAuthenticated && isTokenReady && !isAuthLoading);

  const upsertProject = useCallback((project: Project) => {
    refreshGenerationRef.current += 1;
    setIsLoading(false);
    setProjects((current) => {
      if (!current.some((candidate) => candidate.id === project.id)) {
        return [...current, project];
      }
      return current.map((candidate) => (candidate.id === project.id ? project : candidate));
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!canFetchProjects || !user) return;
    if (Date.now() < rateLimitedUntilRef.current) return;
    const generation = ++refreshGenerationRef.current;
    const userEmail = user.email;
    setIsLoading(true);
    const result = await fetchProjects();
    const isStale =
      generation !== refreshGenerationRef.current || currentUserEmailRef.current !== userEmail;
    if (isStale) {
      return;
    }
    if (result.ok) {
      setProjects(result.value);
    } else if (result.error instanceof ApiClientError && result.error.status === 429) {
      rateLimitedUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    setIsLoading(false);
  }, [canFetchProjects, user]);

  const lastFetchedUserEmail = useRef<string | null>(null);
  const currentUserEmailRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserEmailRef.current = user?.email ?? null;
    if (canFetchProjects && user) {
      if (user.email !== lastFetchedUserEmail.current) {
        rateLimitedUntilRef.current = 0;
        void refreshProjects();
        lastFetchedUserEmail.current = user.email;
      }
    } else {
      if (user && (isAuthLoading || isAuthenticated)) {
        return;
      }
      refreshGenerationRef.current += 1;
      setProjects([]);
      setActiveProjectId(null);
      setIsLoading(false);
      lastFetchedUserEmail.current = null;
      rateLimitedUntilRef.current = 0;
    }
  }, [user, canFetchProjects, isAuthLoading, isAuthenticated, refreshProjects]);

  const createProject = async (name: string, description?: string, instructions?: string) => {
    const result = await createNewProject({
      name,
      description,
      custom_instructions: instructions,
    });
    if (result.ok) {
      await refreshProjects();
      upsertProject(result.value);
      return result.value;
    }
    return null;
  };

  const deleteProject = async (id: number) => {
    const result = await deleteUserProject(id);
    if (result.ok) {
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
      await refreshProjects();
      return true;
    }
    return false;
  };

  const renameProject = async (id: number, name: string) => {
    const result = await updateUserProject(id, { name });
    if (!result.ok) return false;
    setProjects((current) =>
      current.map((project) => (project.id === id ? result.value : project))
    );
    return true;
  };

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        activeProjectId,
        setActiveProjectId,
        isLoading,
        isModalOpen,
        setModalOpen,
        refreshProjects,
        upsertProject,
        createProject,
        deleteProject,
        renameProject,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
};

export const useProjects = () => {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectsProvider');
  }
  return context;
};
