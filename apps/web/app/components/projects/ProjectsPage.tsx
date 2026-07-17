'use client';

import { Folder, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Project } from '@taskforceai/contracts/contracts';

import { useProjects } from '../../lib/projects/ProjectsContext';
import { useAuth } from '../../lib/providers/AuthProvider';
import { useRouter } from '../routing';

export function filterProjects(projects: Project[], searchQuery: string): Project[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return projects;
  return projects.filter((project) =>
    [project.name, project.description, project.custom_instructions]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query))
  );
}

export function ProjectsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { projects, isLoading, setActiveProjectId, setModalOpen } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');

  const visibleProjects = useMemo(
    () => filterProjects(projects, searchQuery),
    [projects, searchQuery]
  );

  const openProject = (projectId: number) => {
    setActiveProjectId(projectId);
    void router.navigate({ to: '/' });
  };

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pt-24 pb-16 sm:px-8 lg:pt-32">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Projects</h1>
          <div className="flex items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 sm:w-72">
              <Search aria-hidden="true" className="shrink-0 text-slate-400" size={17} />
              <span className="sr-only">Search projects</span>
              <input
                type="search"
                aria-label="Search projects"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search projects"
                className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            >
              <Plus aria-hidden="true" size={16} />
              New
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          {isAuthLoading || isLoading ? (
            <ProjectsState message="Loading projects…" />
          ) : !isAuthenticated ? (
            <ProjectsState message="Sign in to manage projects." />
          ) : visibleProjects.length === 0 ? (
            <ProjectsState message={searchQuery.trim() ? 'No projects found' : 'No projects yet'} />
          ) : (
            visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => openProject(project.id)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-slate-200">
                    <Folder aria-hidden="true" size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{project.name}</span>
                    {project.description ? (
                      <span className="mt-1 line-clamp-2 block text-sm leading-5 text-slate-400">
                        {project.description}
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ProjectsState({ message }: { message: string }) {
  return (
    <div className="col-span-full flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-slate-200">
        <Folder aria-hidden="true" size={30} />
      </span>
      <p className="font-medium text-slate-200">{message}</p>
    </div>
  );
}
