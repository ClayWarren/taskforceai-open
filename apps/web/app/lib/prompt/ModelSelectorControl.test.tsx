import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import { cleanup } from '@testing-library/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React, { type ReactNode } from 'react';

import '../../../../../tests/setup/dom';

let lastOnValueChange: ((value: string) => void) | null = null;

vi.mock('@taskforceai/ui-kit/button', () => ({
  Button: React.forwardRef<
    HTMLButtonElement,
    {
      children: ReactNode;
      variant?: string;
      size?: string;
      disabled?: boolean;
      onClick?: () => void;
      type?: 'button' | 'submit';
      className?: string;
    }
  >(({ children, variant: _variant, size: _size, ...props }, ref) => (
    <button ref={ref} {...props}>
      {children}
    </button>
  )),
}));

vi.mock('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="model-selector-content" className={className}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
  }) => {
    lastOnValueChange = onValueChange;
    return <div>{children}</div>;
  },
  DropdownMenuRadioItem: ({
    children,
    value,
    disabled,
  }: {
    children: ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      role="menuitemradio"
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      data-testid={`radio-item-${value}`}
      onClick={() => {
        if (!disabled) lastOnValueChange?.(value);
      }}
    >
      {children}
    </button>
  ),
}));

import { ModelSelectorControl } from './ModelSelectorControl';

const createOption = (
  id: string,
  label: string,
  usageMultiple?: number,
  description?: string
): ModelOptionSummary => ({
  id,
  label,
  badge: 'Default',
  usageMultiple,
  ...(description ? { description } : {}),
});

const baseOptions: ModelOptionSummary[] = [
  createOption('model-1', 'Model One', 1),
  createOption('model-2', 'Model Two', 2),
];

const renderControl = (
  overrides: Partial<{
    enabled: boolean;
    options: ModelOptionSummary[];
    selectedModelId: string | null;
    selectedModelLabel: string | null;
    disabled: boolean;
    loading: boolean;
    onSelect: (modelId: string) => void;
    userPlan: string | null;
    compact: boolean;
    triggerRef: React.Ref<HTMLButtonElement>;
    reasoningEffortLevels: string[];
    selectedReasoningEffort: string | null;
    onReasoningEffortChange: (effort: string) => void;
    reasoningEffortPresentation: 'menu' | 'slider';
    quickModeEnabled: boolean;
    onQuickModeToggle: () => void;
    agentCount: number;
    onAgentCountChange: (count: number) => void;
    onCustomizeOrchestration: () => void;
    roleModels: Record<string, string>;
    onClearCustomModels: () => void;
  }> = {}
) => {
  return render(
    <ModelSelectorControl
      enabled={true}
      options={baseOptions}
      selectedModelId={'model-1'}
      selectedModelLabel={null}
      disabled={false}
      loading={false}
      onSelect={vi.fn()}
      userPlan="pro"
      compact={false}
      {...overrides}
    />
  );
};

describe('ModelSelectorControl', () => {
  beforeEach(() => {
    lastOnValueChange = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a disabled fallback when the selector is unavailable', () => {
    const { container, rerender } = renderControl({ enabled: false, options: [] });
    expect(container.querySelector('.model-selector-trigger__value')?.textContent).toBe('Auto');
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.queryByTestId('model-selector-content')).toBeNull();

    rerender(
      <ModelSelectorControl
        enabled={true}
        options={[]}
        selectedModelId={null}
        selectedModelLabel={null}
        disabled={false}
        loading={false}
        onSelect={vi.fn()}
      />
    );

    expect(container.querySelector('.model-selector-trigger__value')?.textContent).toBe('Auto');
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders while loading and falls back to selectedModelLabel when no active option exists', () => {
    const { container } = renderControl({
      enabled: false,
      options: [],
      loading: true,
      selectedModelId: null,
      selectedModelLabel: 'Last Used Model',
    });

    const triggerValue = container.querySelector('.model-selector-trigger__value');
    expect(triggerValue?.textContent).toBe('Last Used Model');
    expect(screen.queryByTestId('model-selector-content')).toBeNull();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('falls back to "Auto" label when there is no active option and no selected label', () => {
    const { container } = renderControl({
      enabled: false,
      options: [],
      loading: true,
      selectedModelId: null,
      selectedModelLabel: null,
    });

    const triggerValue = container.querySelector('.model-selector-trigger__value');
    expect(triggerValue?.textContent).toBe('Auto');
  });

  it('falls back to the first option when selectedModelId does not match any option', () => {
    const { container } = renderControl({
      selectedModelId: 'missing-model',
      selectedModelLabel: 'Stored Label',
    });

    const triggerValue = container.querySelector('.model-selector-trigger__value');
    expect(triggerValue?.textContent).toBe('Model One');
  });

  it('calls onSelect when a different model is chosen', () => {
    const onSelect = vi.fn();
    renderControl({ onSelect });

    fireEvent.click(screen.getByTestId('radio-item-model-2'));

    expect(onSelect).toHaveBeenCalledWith('model-2');
  });

  it('nests the selected model reasoning effort in a single submenu', () => {
    const onReasoningEffortChange = vi.fn();
    const reasoningOptions: ModelOptionSummary[] = [
      {
        ...createOption('model-1', 'Model One', 1),
        reasoningEffortLevels: ['low', 'high', 'xhigh'],
        defaultReasoningEffort: 'high',
      },
    ];

    renderControl({
      options: reasoningOptions,
      reasoningEffortLevels: ['low', 'high', 'xhigh'],
      selectedReasoningEffort: 'high',
      onReasoningEffortChange,
    });

    expect(screen.getByRole('button', { name: /Effort High/i })).toBeTruthy();
    expect(
      screen.getByText('Higher effort gives the model more room for difficult work.')
    ).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Extra high')).toBeTruthy();

    fireEvent.click(screen.getByTestId('radio-item-xhigh'));

    expect(onReasoningEffortChange).toHaveBeenCalledWith('xhigh');
  });

  it('embeds the desktop reasoning slider in the open model selector', () => {
    const onReasoningEffortChange = vi.fn();
    const { container } = renderControl({
      reasoningEffortLevels: ['low', 'medium', 'high'],
      selectedReasoningEffort: 'medium',
      reasoningEffortPresentation: 'slider',
      onReasoningEffortChange,
    });

    expect(container.querySelector('.model-selector-effort-slider')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Effort Medium/i })).toBeNull();
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium');
    fireEvent.input(slider, { target: { value: '2' } });
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
  });

  it('nests single agent and agent teams configuration in the model selector', () => {
    const onQuickModeToggle = vi.fn();
    const onAgentCountChange = vi.fn();
    renderControl({
      quickModeEnabled: false,
      onQuickModeToggle,
      agentCount: 3,
      onAgentCountChange,
      onCustomizeOrchestration: vi.fn(),
    });

    expect(screen.getByRole('button', { name: /Agent Mode Agent Teams/i })).toBeTruthy();
    expect(screen.getByText('Single Agent')).toBeTruthy();
    expect(screen.getAllByText('Agent Teams')).toHaveLength(2);
    expect(screen.getByText('Parallel agents')).toBeTruthy();
    expect(screen.getByText('Custom Models')).toBeTruthy();

    fireEvent.click(screen.getByTestId('radio-item-4'));
    expect(onAgentCountChange).toHaveBeenCalledWith(4);
  });

  it('keeps effort and agent mode outside the scrollable model list', () => {
    const { container } = renderControl({
      reasoningEffortLevels: ['low', 'high'],
      selectedReasoningEffort: 'high',
      onReasoningEffortChange: vi.fn(),
      quickModeEnabled: true,
      onQuickModeToggle: vi.fn(),
    });

    const modelList = container.querySelector('.model-selector-menu__models');
    const controls = container.querySelector('.model-selector-menu__controls');

    expect(modelList).toBeTruthy();
    expect(controls).toBeTruthy();
    expect(modelList?.textContent).toContain('Model One');
    expect(modelList?.textContent).not.toContain('Effort');
    expect(controls?.textContent).toContain('Effort');
    expect(controls?.textContent).toContain('Agent Mode');
  });

  it('switches from single agent to agent teams explicitly', () => {
    const onQuickModeToggle = vi.fn();
    renderControl({ quickModeEnabled: true, onQuickModeToggle });

    fireEvent.click(screen.getByTestId('radio-item-teams'));

    expect(onQuickModeToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Parallel agents')).toBeNull();
    expect(screen.queryByText('Custom Models')).toBeNull();
  });

  it('renders provider branding and model descriptions without exposing Sentinel backing provider', () => {
    const brandedOptions: ModelOptionSummary[] = [
      createOption(
        'zai/glm-5.2',
        'Sentinel',
        1,
        'Our flagship high-reasoning model for complex task planning.'
      ),
      createOption('openai/gpt-5.6-sol', 'GPT 5.6 Sol', 3, 'OpenAI flagship reasoning.'),
      createOption('google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 1, 'Google research tier.'),
      createOption('xai/grok-4.5', 'Grok 4.5', 2, 'xAI heavy reasoning tier.'),
      createOption('meta/muse-spark-1.1', 'Muse Spark 1.1', 1, 'Meta agentic model.'),
      createOption('anthropic/claude-fable-5', 'Claude Fable 5', 2, 'Anthropic fallback coverage.'),
    ];

    const { container } = renderControl({
      options: brandedOptions,
      selectedModelId: 'zai/glm-5.2',
    });

    expect(
      container.querySelector('.model-selector-trigger .model-selector-provider-mark--sentinel')
    ).toBeNull();
    expect(
      container.querySelector('.model-selector-provider-mark--sentinel img')?.getAttribute('src')
    ).toBe('/icon.png');
    expect(container.querySelector('.model-selector-provider-mark--openai')).toBeTruthy();
    expect(screen.getAllByLabelText('Medium cost: $$').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Very high cost: $$$+')).toBeTruthy();
    expect(
      container.querySelector('.model-selector-provider-mark--openai img')?.getAttribute('src')
    ).toBe('/provider-logos/openai.png');
    expect(container.querySelector('.model-selector-provider-mark--google')).toBeTruthy();
    expect(
      container.querySelector('.model-selector-provider-mark--google img')?.getAttribute('src')
    ).toBe('/provider-logos/gemini.png');
    expect(container.querySelector('.model-selector-provider-mark--xai')).toBeTruthy();
    expect(
      container.querySelector('.model-selector-provider-mark--xai img')?.getAttribute('src')
    ).toBe('/provider-logos/xai.png');
    expect(container.querySelector('.model-selector-provider-mark--meta')).toBeTruthy();
    expect(
      container.querySelector('.model-selector-provider-mark--meta img')?.getAttribute('src')
    ).toBe('/provider-logos/meta.png');
    expect(container.querySelector('.model-selector-provider-mark--anthropic')).toBeTruthy();
    expect(
      container.querySelector('.model-selector-provider-mark--anthropic img')?.getAttribute('src')
    ).toBe('/provider-logos/anthropic.png');
    expect(screen.getByText('OpenAI flagship reasoning.')).toBeTruthy();
    expect(screen.getAllByText('TaskForceAI provider')).toHaveLength(1);
    expect(document.body.textContent ?? '').not.toMatch(/zai|glm-5\.2/i);
  });

  it('locks high-cost models until the user subscribes', () => {
    renderControl({
      userPlan: 'free',
      options: [
        createOption('google/gemini-3.5-flash', 'Gemini Flash', 1.5),
        createOption('anthropic/claude-sonnet-5', 'Claude Sonnet', 2),
        createOption('openai/gpt-5.6-sol', 'GPT Sol', 5),
      ],
      selectedModelId: 'google/gemini-3.5-flash',
    });

    expect(screen.getByTestId('radio-item-google/gemini-3.5-flash')).not.toHaveAttribute(
      'data-disabled'
    );
    expect(screen.getByTestId('radio-item-anthropic/claude-sonnet-5')).toHaveAttribute(
      'data-disabled'
    );
    expect(screen.getByTestId('radio-item-openai/gpt-5.6-sol')).toHaveAttribute('data-disabled');
    expect(screen.getAllByText('Pro')).toHaveLength(2);
  });

  it('forwards the trigger ref for keyboard shortcut activation', () => {
    const triggerRef = React.createRef<HTMLButtonElement>();
    renderControl({ triggerRef });

    expect(triggerRef.current?.className).toContain('model-selector-trigger');
  });
});
