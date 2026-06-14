import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'bun:test';

const mockUseProjects = vi.fn(() => ({
  projects: [],
  isModalOpen: true,
  setModalOpen: vi.fn(),
  createProject: vi.fn().mockResolvedValue({ id: 1, name: 'New Project' }),
  deleteProject: vi.fn(),
  refreshProjects: vi.fn(),
  activeProjectId: null,
  setActiveProjectId: vi.fn(),
  isLoading: false,
}));

vi.mock('../../lib/projects/ProjectsContext', () => ({
  useProjects: mockUseProjects,
}));

vi.mock('@taskforceai/ui-kit', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} data-testid="input" />,
  Textarea: (props: any) => <textarea {...props} data-testid="textarea" />,
}));

import ProjectModal from './ProjectModal';

describe('ProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when modal is closed', () => {
    mockUseProjects.mockReturnValue({
      ...mockUseProjects(),
      isModalOpen: false,
    });
    const { container } = render(<ProjectModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when open', () => {
    mockUseProjects.mockReturnValue({
      ...mockUseProjects(),
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByText('Create new project')).toBeTruthy();
  });

  it('renders form fields', () => {
    mockUseProjects.mockReturnValue({
      ...mockUseProjects(),
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByPlaceholderText('e.g., Q1 Marketing Plan')).toBeTruthy();
    expect(screen.getByPlaceholderText('What is this project about?')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Instructions for the AI within this project...')
    ).toBeTruthy();
  });

  it('renders create button', () => {
    mockUseProjects.mockReturnValue({
      ...mockUseProjects(),
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByRole('button', { name: /create project/i })).toBeTruthy();
  });

  it('renders cancel button', () => {
    mockUseProjects.mockReturnValue({
      ...mockUseProjects(),
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });
});
