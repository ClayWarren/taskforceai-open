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
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="model-selector-content">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  DropdownMenuRadioItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <button
      type="button"
      data-testid={`radio-item-${value}`}
      onClick={() => {
        lastOnValueChange?.(value);
      }}
    >
      {children}
    </button>
  ),
}));

import { ModelSelectorControl } from './ModelSelectorControl';

const createOption = (id: string, label: string, usageMultiple?: number): ModelOptionSummary => ({
  id,
  label,
  badge: 'Default',
  usageMultiple,
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
    compact: boolean;
    triggerRef: React.Ref<HTMLButtonElement>;
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

  it('forwards the trigger ref for keyboard shortcut activation', () => {
    const triggerRef = React.createRef<HTMLButtonElement>();
    renderControl({ triggerRef });

    expect(triggerRef.current?.className).toContain('model-selector-trigger');
  });
});
