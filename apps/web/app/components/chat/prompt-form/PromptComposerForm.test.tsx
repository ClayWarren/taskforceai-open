import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

import { PromptComposerForm } from './PromptComposerForm';
import type { PromptTemplate } from './promptTemplates';

vi.mock('./AutoResizingTextarea', () => ({
  AutoResizingTextarea: React.forwardRef<HTMLTextAreaElement, any>(
    (
      {
        minHeight: _minHeight,
        onEnterPress,
        onKeyDown,
        onValueChange: _onValueChange,
        value,
        ...props
      },
      ref
    ) => {
      return (
        <div
          {...props}
          ref={ref as React.Ref<HTMLDivElement>}
          role="textbox"
          tabIndex={props['disabled'] ? -1 : 0}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onEnterPress?.(event);
            }
          }}
        >
          {value}
        </div>
      );
    }
  ),
}));

type PromptComposerFormProps = React.ComponentProps<typeof PromptComposerForm>;

vi.mock('./PromptActions', () => ({
  PromptActions: ({ primaryButtonTitle, onPrimaryButtonClick }: any) => (
    <button type="button" title={primaryButtonTitle} onClick={onPrimaryButtonClick}>
      {primaryButtonTitle}
    </button>
  ),
}));

vi.mock('./PromptAttachments', () => ({
  PromptAttachments: ({
    files,
    onRemove,
    onShowInTextField,
  }: {
    files: File[];
    onRemove: (_index: number) => void;
    onShowInTextField: (_index: number) => void;
  }) => (
    <div>
      {files.map((file, index) => (
        <React.Fragment key={`${file.name}-${index}`}>
          <button type="button" onClick={() => onRemove(index)}>
            {file.name}
          </button>
          <button type="button" onClick={() => onShowInTextField(index)}>
            Show {file.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  ),
}));

vi.mock('./PromptAddMenu', () => ({
  PromptAddMenu: ({
    buttonClassName,
    disabled,
    onFileButtonClick,
    onInsertPromptTemplate,
    promptTemplates,
  }: {
    buttonClassName: string;
    disabled: boolean;
    onFileButtonClick: () => void;
    onInsertPromptTemplate: (_template: PromptTemplate) => void;
    promptTemplates: PromptTemplate[];
  }) => (
    <div>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        title="Add files and more"
        onClick={onFileButtonClick}
      >
        +
      </button>
      {promptTemplates.length > 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => promptTemplates[0] && onInsertPromptTemplate(promptTemplates[0])}
        >
          Prompts
        </button>
      ) : null}
    </div>
  ),
}));

const baseProps = (): PromptComposerFormProps => ({
  controlsDisabled: false,
  customRoleModels: {},
  effectiveModelId: 'gpt-5',
  effectiveModelLabel: 'GPT-5',
  fileAccept: '*/*',
  fileInputRef: React.createRef<HTMLInputElement>(),
  files: [] as File[],
  handleFileChange: vi.fn(),
  handleFileDragLeave: vi.fn(),
  handleFileDragOver: vi.fn(),
  handleFileDrop: vi.fn(),
  iconButtonBaseClass: 'icon-button',
  isDraggingFiles: false,
  isCompactForm: false,
  isListening: false,
  loading: false,
  minPromptHeight: 44,
  modelOptions: [],
  modelSelectorDisabled: false,
  modelSelectorEnabled: true,
  modelSelectorLoading: false,
  onClearCustomModels: vi.fn(),
  onCustomizeOrchestration: vi.fn(),
  onFileButtonClick: vi.fn(),
  onKeyDown: vi.fn(),
  onModelSelect: vi.fn(),
  reasoningEffortLevels: [],
  selectedReasoningEffort: null,
  reasoningEffortVariant: 'select',
  onReasoningEffortChange: vi.fn(),
  onDictationClick: vi.fn(),
  onAcceptDictation: vi.fn(),
  onCancelDictation: vi.fn(),
  onPrimaryButtonClick: vi.fn(),
  onRealtimeVoiceClick: vi.fn(),
  onRealtimeVoicePrewarm: vi.fn(),
  onInsertPromptTemplate: vi.fn(),
  onQuickModeToggle: vi.fn(),
  agentCount: 3,
  onAgentCountChange: vi.fn(),
  onRemoveFileAtIndex: vi.fn(),
  onShowAttachmentInTextField: vi.fn(),
  onLargePaste: vi.fn(() => true),
  onSubmit: vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault()),
  placeholderText: 'Ask TaskForce',
  primaryButtonClassName: 'primary',
  primaryButtonDisabled: false,
  primaryButtonMode: 'send' as const,
  primaryButtonTitle: 'Send message',
  prompt: '',
  promptTemplates: [],
  quickModeEnabled: true,
  realtimeVoiceActive: false,
  realtimeVoiceDisabled: false,
  realtimeVoiceTitle: 'Use voice',
  setPrompt: vi.fn(),
  textareaRef: React.createRef<HTMLTextAreaElement>(),
  variant: 'centered',
  workMode: false,
});

const renderComposer = (overrides: Partial<PromptComposerFormProps> = {}) => {
  const initialProps = { ...baseProps(), ...overrides };
  const promptSetter = vi.fn();

  function Harness() {
    const [prompt, setPrompt] = useState(initialProps.prompt);
    return (
      <PromptComposerForm
        {...initialProps}
        prompt={prompt}
        setPrompt={(value) => {
          promptSetter(value);
          setPrompt(value);
        }}
      />
    );
  }

  return {
    ...render(<Harness />),
    promptSetter,
  };
};

describe('PromptComposerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders expanded drag and attachment states with the add menu trigger', () => {
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    renderComposer({
      controlsDisabled: true,
      files: [file],
      isDraggingFiles: true,
      variant: 'bottom',
    });

    const form = screen.getByRole('form', { name: 'Prompt submission form' });
    expect(form.className).toContain('chat-aligned');
    expect(form.className).toContain('prompt-form--expanded');
    expect(form.className).toContain('ring-2');
    expect(screen.getByText('Drop files to attach')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'notes.txt' })).toBeInTheDocument();
    expect(screen.getByTitle('Add files and more')).toBeDisabled();
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).toBeNull();
  });

  it('uses the expanded task composer layout in Work mode', () => {
    renderComposer({ workMode: true });

    expect(screen.getByRole('form', { name: 'Prompt submission form' }).className).toContain(
      'prompt-form--expanded'
    );
  });

  it('cycles slash suggestions with the keyboard and accepts the selected command with Tab', async () => {
    const { promptSetter } = renderComposer({ prompt: '/' });
    const textbox = screen.getByRole('textbox');

    expect(screen.getByRole('option', { name: /\/login/i }).getAttribute('aria-selected')).toBe(
      'true'
    );

    fireEvent.keyDown(textbox, { key: 'ArrowDown' });

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /\/logout/i }).getAttribute('aria-selected')).toBe(
        'true'
      )
    );

    fireEvent.keyDown(textbox, { key: 'Tab' });

    await waitFor(() => expect(textbox).toHaveTextContent('/logout'));
    expect(promptSetter).toHaveBeenLastCalledWith('/logout');
  });

  it('leaves exact slash commands available for normal Enter submission', () => {
    const onKeyDown = vi.fn();
    renderComposer({ onKeyDown, prompt: '/status' });
    const textbox = screen.getByRole('textbox');

    fireEvent.keyDown(textbox, { key: 'Enter' });

    expect(onKeyDown).toHaveBeenCalled();
    expect(textbox).toHaveTextContent('/status');
  });

  it('routes non-Enter prompt shortcuts through the controller key handler', () => {
    const onKeyDown = vi.fn();
    renderComposer({ onKeyDown });
    const textbox = screen.getByRole('textbox');

    fireEvent.keyDown(textbox, {
      ctrlKey: true,
      key: 'V',
      shiftKey: true,
    });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('V');
  });

  it('converts pastes over 10,000 characters when the attachment is accepted', () => {
    const onLargePaste = vi.fn(() => true);
    renderComposer({ onLargePaste });
    const textbox = screen.getByRole('textbox');
    const content = 'a'.repeat(10_001);

    const event = fireEvent.paste(textbox, {
      clipboardData: { getData: () => content },
    });

    expect(event).toBe(false);
    expect(onLargePaste).toHaveBeenCalledWith(content);
  });

  it('leaves 10,000-character and rejected pastes in the text field', () => {
    const onLargePaste = vi.fn(() => false);
    renderComposer({ onLargePaste });
    const textbox = screen.getByRole('textbox');

    const thresholdEvent = fireEvent.paste(textbox, {
      clipboardData: { getData: () => 'a'.repeat(10_000) },
    });
    const rejectedEvent = fireEvent.paste(textbox, {
      clipboardData: { getData: () => 'a'.repeat(10_001) },
    });

    expect(thresholdEvent).toBe(true);
    expect(rejectedEvent).toBe(true);
    expect(onLargePaste).toHaveBeenCalledTimes(1);
  });

  it('accepts slash suggestions with the pointer and returns focus to the textarea', async () => {
    const { promptSetter } = renderComposer({ prompt: '/mo' });
    const textbox = screen.getByRole('textbox');

    fireEvent.mouseEnter(screen.getByRole('option', { name: /\/model/i }));
    fireEvent.mouseDown(screen.getByRole('option', { name: /\/model/i }));

    await waitFor(() => expect(textbox).toHaveTextContent('/model'));
    expect(promptSetter).toHaveBeenLastCalledWith('/model');
    expect(document.activeElement).toBe(textbox);
  });
});
