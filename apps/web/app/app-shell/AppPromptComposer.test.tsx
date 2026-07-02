import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const promptFormMock = mock((props: any) => (
  <div data-testid="prompt-form">
    <span>{props.promptValue}</span>
    <span>{props.mcpToolSummary}</span>
    <span>{props.mcpToolItems.length} tools</span>
    <span>variant:{props.variant}</span>
    <button type="button" onClick={() => props.onPromptValueChange('updated prompt')}>
      Change prompt
    </button>
    <button type="button" onClick={() => props.onRealtimeVoiceActiveChange?.(true)}>
      Activate voice
    </button>
    <button type="button" onClick={() => props.onRealtimeVoiceActiveChange?.(false)}>
      Deactivate voice
    </button>
  </div>
));

const imageMock = mock((props: any) => <img alt={props.alt} src={props.src} />);
const usePromptFormBridge = mock();

mock.module('../components/chat/PromptForm', () => ({
  default: promptFormMock,
}));

mock.module('../components/shared/Image', () => ({
  Image: imageMock,
}));

mock.module('./usePromptFormBridge', () => ({
  usePromptFormBridge,
}));

import { AppPromptComposer } from './AppPromptComposer';

const session = { messages: [] } as any;

const defaultProps = {
  session,
  initialModelSelector: null,
  isDisabled: false,
  promptVariant: 'centered' as const,
  promptValue: 'Draft task',
  showPromptLogo: false,
  onPromptValueChange: mock(),
  updateToRemoteConversation: mock(),
  variant: 'centered' as const,
};

describe('AppPromptComposer', () => {
  beforeEach(() => {
    promptFormMock.mockClear();
    imageMock.mockClear();
    usePromptFormBridge.mockReset();
    defaultProps.onPromptValueChange.mockReset();
    defaultProps.updateToRemoteConversation.mockReset();
    usePromptFormBridge.mockReturnValue({
      mcpToolCatalog: {
        toolSummary: '2 local tools',
        items: [{ id: 'tool-1' }, { id: 'tool-2' }],
      },
      promptFormProps: {
        disabled: false,
        platformRuntime: 'desktop',
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when the active prompt variant does not match this composer', () => {
    render(<AppPromptComposer {...defaultProps} variant="bottom" />);

    expect(screen.queryByTestId('prompt-form')).toBeNull();
    expect(promptFormMock).not.toHaveBeenCalled();
    expect(usePromptFormBridge).toHaveBeenCalledWith({
      session,
      initialModelSelector: null,
      isDisabled: false,
      updateToRemoteConversation: defaultProps.updateToRemoteConversation,
      variant: 'bottom',
    });
  });

  it('renders the centered composer logo and forwards bridge props to PromptForm', () => {
    render(<AppPromptComposer {...defaultProps} showPromptLogo={true} />);

    expect(screen.getByAltText('TaskForceAI logo')).toBeTruthy();
    expect(screen.getByText('Draft task')).toBeTruthy();
    expect(screen.getByText('2 local tools')).toBeTruthy();
    expect(screen.getByText('2 tools')).toBeTruthy();
    expect(promptFormMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        disabled: false,
        platformRuntime: 'desktop',
        mcpToolSummary: '2 local tools',
        mcpToolItems: [{ id: 'tool-1' }, { id: 'tool-2' }],
        promptValue: 'Draft task',
        onPromptValueChange: defaultProps.onPromptValueChange,
      })
    );
  });

  it('renders the bottom composer with fixed positioning class and forwards prompt changes', () => {
    const { container } = render(
      <AppPromptComposer {...defaultProps} promptVariant="bottom" variant="bottom" />
    );

    expect(container.querySelector('.prompt-form-container--fixed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change prompt' }));
    expect(defaultProps.onPromptValueChange).toHaveBeenCalledWith('updated prompt');
  });

  it('hides the centered logo and uses the bottom layout while realtime voice is active', () => {
    const { container } = render(<AppPromptComposer {...defaultProps} showPromptLogo={true} />);

    expect(screen.getByAltText('TaskForceAI logo')).toBeTruthy();
    expect(screen.getByText('variant:centered')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activate voice' }));

    expect(screen.queryByAltText('TaskForceAI logo')).toBeNull();
    expect(container.querySelector('.prompt-form-container--fixed')).toBeTruthy();
    expect(container.querySelector('.prompt-form-container--voice-active')).toBeTruthy();
    expect(container.querySelector('.centered-variant')).toBeNull();
    expect(promptFormMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        variant: 'bottom',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate voice' }));

    expect(screen.getByAltText('TaskForceAI logo')).toBeTruthy();
    expect(container.querySelector('.prompt-form-container--voice-active')).toBeNull();
    expect(promptFormMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        variant: 'centered',
      })
    );
  });

  it('notifies the shell when realtime voice activation changes', () => {
    const onRealtimeVoiceActiveChange = mock();
    render(
      <AppPromptComposer
        {...defaultProps}
        onRealtimeVoiceActiveChange={onRealtimeVoiceActiveChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Activate voice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate voice' }));

    expect(onRealtimeVoiceActiveChange).toHaveBeenNthCalledWith(1, true);
    expect(onRealtimeVoiceActiveChange).toHaveBeenNthCalledWith(2, false);
  });
});
