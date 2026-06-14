'use client';

import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import React from 'react';

import { Button } from '@taskforceai/ui-kit';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit';
import { formatUsageMultiple } from '@taskforceai/shared';

interface ModelSelectorControlProps {
  enabled: boolean;
  options: ModelOptionSummary[];
  selectedModelId: string | null;
  selectedModelLabel: string | null;
  disabled: boolean;
  loading: boolean;
  onSelect: (_modelId: string) => void;
  compact?: boolean;
}

export const ModelSelectorControl: React.FC<ModelSelectorControlProps> = ({
  enabled,
  options,
  selectedModelId,
  disabled,
  loading,
  onSelect,
  selectedModelLabel,
  compact = false,
}) => {
  const hasOptions = options.length > 0;
  const shouldRender = loading || enabled || Boolean(selectedModelId || selectedModelLabel);

  if (!shouldRender) {
    return null;
  }

  const activeOption = hasOptions
    ? (options.find((option) => option.id === selectedModelId) ?? options[0] ?? null)
    : null;

  const triggerLabel = activeOption?.label ?? selectedModelLabel ?? 'Auto';
  const triggerUsage = formatUsageMultiple(activeOption?.usageMultiple);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`model-selector-trigger ${compact ? 'model-selector-trigger--compact' : ''}`}
          disabled={disabled || loading || !enabled || !hasOptions}
        >
          <div className="flex flex-col text-left leading-tight">
            <div className="model-selector-trigger__value-row">
              <span className="model-selector-trigger__value">{triggerLabel}</span>
              {triggerUsage ? (
                <span className="model-selector-trigger__badge hidden md:inline-flex">
                  {triggerUsage}
                </span>
              ) : null}
              <span className="model-selector-trigger__chevron" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>
        </Button>
      </DropdownMenuTrigger>
      {hasOptions ? (
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="model-selector-menu overflow-hidden rounded-lg"
        >
          <DropdownMenuLabel>Choose a model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selectedModelId ?? activeOption?.id ?? ''}
            onValueChange={(value) => onSelect(value)}
          >
            {options.map((option) => {
              const optionUsage = formatUsageMultiple(option.usageMultiple);
              return (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="model-selector-item"
                >
                  <div className="flex flex-col text-left leading-tight">
                    <div className="flex items-center justify-between gap-2">
                      <span className="model-selector-option__label">{option.label}</span>
                      {optionUsage ? (
                        <span className="model-selector-option__badge">{optionUsage}</span>
                      ) : null}
                    </div>
                  </div>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
};
