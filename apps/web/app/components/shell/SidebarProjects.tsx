import clsx from 'clsx';

interface SidebarProject {
  id: number;
  name: string;
}

interface SidebarProjectsProps {
  activeProjectId: number | null;
  projects: SidebarProject[];
  onManageProjects: () => void;
  onSelectProject: (projectId: number | null) => void;
}

export const SidebarProjects: React.FC<SidebarProjectsProps> = ({
  activeProjectId,
  projects,
  onManageProjects,
  onSelectProject,
}) => (
  <div className="mb-4 space-y-1">
    <div className="sidebar-section-heading mb-2 px-1 text-[11px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
      Projects
    </div>
    <button
      onClick={() => onSelectProject(null)}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
        activeProjectId === null
          ? 'bg-white/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      )}
    >
      <span>General</span>
    </button>
    {projects.map((project) => (
      <button
        key={project.id}
        onClick={() => onSelectProject(project.id)}
        className={clsx(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
          activeProjectId === project.id
            ? 'bg-white/10 text-white'
            : 'text-slate-400 hover:bg-white/5 hover:text-white'
        )}
      >
        <span className="flex-1 truncate">{project.name}</span>
      </button>
    ))}
    <button
      onClick={onManageProjects}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
    >
      <span>＋</span>
      <span>Manage projects</span>
    </button>
  </div>
);
