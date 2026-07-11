import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import ConversationItem from './ConversationItem';

vi.mock('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: any) => (
    <button type="button" onClick={(event) => onSelect(event)}>
      {children}
    </button>
  ),
}));

describe('ConversationItem', () => {
  afterEach(() => cleanup());

  const mockConversation = {
    id: 123,
    user_input: 'Initial Prompt',
    timestamp: new Date().toISOString(),
    result: 'Reply',
  };

  it('renders conversation title', () => {
    render(
      <ConversationItem conversation={mockConversation} onClick={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText('Initial Prompt')).toBeTruthy();
  });

  it('shows a compact sidebar title while preserving the full title attribute', () => {
    render(
      <ConversationItem
        conversation={{
          ...mockConversation,
          user_input: 'Biggest news in AI today and tomorrow',
        }}
        onClick={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Biggest news in AI today')).toBeTruthy();
    expect(screen.queryByText('Biggest news in AI today and tomorrow')).toBeNull();
    const conversationButton = screen.getByRole('button', {
      name: 'Conversation: Biggest news in AI today and tomorrow',
    });
    expect(conversationButton.getAttribute('title')).toBe('Biggest news in AI today and tomorrow');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <ConversationItem conversation={mockConversation} onClick={onClick} onDelete={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Initial Prompt'));
    expect(onClick).toHaveBeenCalledWith(123);
  });

  it('marks the active conversation for visual and accessibility state', () => {
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isActive={true}
      />
    );

    const conversationButton = screen.getByRole('button', {
      name: 'Conversation: Initial Prompt',
    });
    expect(conversationButton.getAttribute('aria-current')).toBe('page');
    expect(conversationButton.closest('.conversation-item')?.className).toContain(
      'conversation-item--active'
    );
  });

  it('renders editing form when isEditing is true', () => {
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isEditing={true}
        editValue="New Title"
      />
    );
    const input = screen.getByPlaceholderText('Conversation title');
    expect((input as HTMLInputElement).value).toBe('New Title');
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('calls onEditSubmit on form submit', () => {
    const onEditSubmit = vi.fn();
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isEditing={true}
        editValue="Renamed"
        onEditSubmit={onEditSubmit}
      />
    );
    const form = screen.getByText('Save').closest('form');
    if (!form) {
      throw new Error('Expected edit form');
    }
    fireEvent.submit(form);
    expect(onEditSubmit).toHaveBeenCalled();
  });

  it('does not submit rename when title is blank after trim', () => {
    const onEditSubmit = vi.fn();
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isEditing={true}
        editValue="   "
        onEditSubmit={onEditSubmit}
      />
    );

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    const form = saveButton.closest('form');
    if (!form) {
      throw new Error('Expected edit form');
    }

    fireEvent.submit(form);
    expect(onEditSubmit).not.toHaveBeenCalled();
  });

  it('calls onEditCancel on cancel click', () => {
    const onEditCancel = vi.fn();
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isEditing={true}
        onEditCancel={onEditCancel}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onEditCancel).toHaveBeenCalled();
  });

  it('calls onEditChange while editing', async () => {
    const onEditChange = vi.fn();
    const user = userEvent.setup({ document: globalThis.document });
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onDelete={vi.fn()}
        isEditing={true}
        editValue="Draft title"
        onEditChange={onEditChange}
      />
    );

    await user.type(screen.getByPlaceholderText('Conversation title'), '!');

    expect(onEditChange).toHaveBeenCalled();
    expect(onEditChange).toHaveBeenLastCalledWith('Draft title!');
  });

  it('shows unread state and handles dropdown rename/archive/delete actions', () => {
    const onRenameRequest = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConversationItem
        conversation={mockConversation}
        onClick={vi.fn()}
        onArchive={onArchive}
        onDelete={onDelete}
        onRenameRequest={onRenameRequest}
        hasUnread={true}
      />
    );

    expect(screen.getByLabelText('New message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onRenameRequest).toHaveBeenCalledWith(123);
    expect(onArchive).toHaveBeenCalledWith(123);
    expect(onDelete).toHaveBeenCalledWith(123);
  });
});
