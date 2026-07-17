import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const buildProjectContext = (overrides: Record<string, unknown> = {}) => ({
  projects: [],
  isModalOpen: true,
  setModalOpen: vi.fn(),
  createProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn(),
  refreshProjects: vi.fn(),
  activeProjectId: null,
  setActiveProjectId: vi.fn(),
  isLoading: false,
  ...overrides,
});

let projectContext = buildProjectContext();
const mockUseProjects = vi.fn(() => projectContext);

vi.mock('../../lib/projects/ProjectsContext', () => ({
  useProjects: mockUseProjects,
}));

vi.mock('@taskforceai/ui-kit/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@taskforceai/ui-kit/input', () => ({
  Input: (props: any) => <input {...props} data-testid="input" />,
}));

vi.mock('@taskforceai/ui-kit/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} data-testid="textarea" />,
}));

import ProjectModal from './ProjectModal';

describe('ProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectContext = buildProjectContext();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders null when modal is closed', () => {
    projectContext = buildProjectContext({
      isModalOpen: false,
    });
    const { container } = render(<ProjectModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when open', () => {
    projectContext = buildProjectContext({
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByText('Create new project')).toBeTruthy();
  });

  it('renders form fields', () => {
    projectContext = buildProjectContext({
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
    projectContext = buildProjectContext({
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByRole('button', { name: /create project/i })).toBeTruthy();
  });

  it('renders cancel button', () => {
    projectContext = buildProjectContext({
      isModalOpen: true,
    });
    render(<ProjectModal />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('keeps submit disabled until the project name has non-whitespace content', async () => {
    const user = userEvent.setup({ document: globalThis.document });
    render(<ProjectModal />);

    const createButton = screen.getByRole('button', { name: /create project/i });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('e.g., Q1 Marketing Plan'), '   ');
    expect(createButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('e.g., Q1 Marketing Plan'), 'Launch');
    expect(createButton).not.toBeDisabled();
  });

  it('creates a project, clears the form, and closes the modal on success', async () => {
    const user = userEvent.setup({ document: globalThis.document });
    render(<ProjectModal />);

    const nameInput = screen.getByPlaceholderText('e.g., Q1 Marketing Plan');
    const descriptionInput = screen.getByPlaceholderText('What is this project about?');
    const instructionsInput = screen.getByPlaceholderText(
      'Instructions for the AI within this project...'
    );

    await user.type(nameInput, 'Launch plan');
    await user.type(descriptionInput, 'Coordinate release work');
    await user.type(instructionsInput, 'Prefer concise planning notes.');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(projectContext.createProject).toHaveBeenCalledWith(
        'Launch plan',
        'Coordinate release work',
        'Prefer concise planning notes.'
      );
    });
    expect(projectContext.setModalOpen).toHaveBeenCalledWith(false);
    await waitFor(() => expect(nameInput).toHaveValue(''));
    expect(descriptionInput).toHaveValue('');
    expect(instructionsInput).toHaveValue('');
  });

  it('keeps the modal open and preserves input when project creation fails', async () => {
    const user = userEvent.setup({ document: globalThis.document });
    projectContext = buildProjectContext({
      createProject: vi.fn().mockResolvedValue(false),
    });
    render(<ProjectModal />);

    const nameInput = screen.getByPlaceholderText('e.g., Q1 Marketing Plan');
    await user.type(nameInput, 'Unfinished project');
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(projectContext.createProject).toHaveBeenCalledWith('Unfinished project', '', '');
    });
    expect(projectContext.setModalOpen).not.toHaveBeenCalled();
    expect(nameInput).toHaveValue('Unfinished project');
  });

  it('closes from the close button, cancel button, and backdrop', async () => {
    const user = userEvent.setup({ document: globalThis.document });
    const { container } = render(<ProjectModal />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await user.click(container.ownerDocument.querySelector('.profile-modal-overlay') as Element);

    expect(projectContext.setModalOpen).toHaveBeenCalledTimes(3);
    expect(projectContext.setModalOpen).toHaveBeenNthCalledWith(1, false);
    expect(projectContext.setModalOpen).toHaveBeenNthCalledWith(2, false);
    expect(projectContext.setModalOpen).toHaveBeenNthCalledWith(3, false);
  });
});
