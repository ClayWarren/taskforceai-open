'use client';

import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import { Gauge } from 'lucide-react';
import React from 'react';

import { Button } from '@taskforceai/ui-kit/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@taskforceai/ui-kit/tooltip';
import { formatUsageMultiple } from '@taskforceai/client-core';

import { formatReasoningEffortLabel } from './reasoning-effort';

interface ModelSelectorControlProps {
  enabled: boolean;
  options: ModelOptionSummary[];
  selectedModelId: string | null;
  selectedModelLabel: string | null;
  disabled: boolean;
  loading: boolean;
  onSelect: (_modelId: string) => void;
  compact?: boolean;
  triggerRef?: React.Ref<HTMLButtonElement>;
  tooltip?: React.ReactNode;
  title?: string;
  bare?: boolean;
  reasoningEffortLevels?: string[];
  selectedReasoningEffort?: string | null;
  onReasoningEffortChange?: (effort: string) => void;
}

type ProviderBrandKey = 'sentinel' | 'openai' | 'anthropic' | 'google' | 'xai' | 'meta' | 'generic';

interface ProviderBrand {
  key: ProviderBrandKey;
  label: string;
  glyph: string;
  assetSrc?: string;
}

const defaultValue = <T,>(value: T | null | undefined, fallback: T): T => value ?? fallback;

const modelSelectorState = (
  options: ModelOptionSummary[],
  selectedModelId: string | null,
  selectedModelLabel: string | null,
  loading: boolean,
  enabled: boolean
) => {
  const hasOptions = options.length > 0;
  const activeOption = hasOptions
    ? (options.find((option) => option.id === selectedModelId) ?? options[0] ?? null)
    : null;
  return {
    hasOptions,
    activeOption,
    shouldRender: loading || enabled || Boolean(selectedModelId || selectedModelLabel),
    triggerLabel: activeOption?.label ?? selectedModelLabel ?? 'Auto',
    triggerUsage: formatUsageMultiple(activeOption?.usageMultiple),
    radioValue: selectedModelId ?? activeOption?.id ?? '',
  };
};

const PROVIDER_BRANDS: Record<ProviderBrandKey, ProviderBrand> = {
  sentinel: { key: 'sentinel', label: 'TaskForceAI', glyph: 'S', assetSrc: '/icon.png' },
  openai: {
    key: 'openai',
    label: 'OpenAI',
    glyph: 'OA',
    assetSrc: '/provider-logos/openai.png',
  },
  anthropic: {
    key: 'anthropic',
    label: 'Anthropic',
    glyph: 'A',
    assetSrc: '/provider-logos/anthropic.png',
  },
  google: {
    key: 'google',
    label: 'Google',
    glyph: 'G',
    assetSrc: '/provider-logos/gemini.png',
  },
  xai: { key: 'xai', label: 'xAI', glyph: 'xAI', assetSrc: '/provider-logos/xai.png' },
  meta: {
    key: 'meta',
    label: 'Meta',
    glyph: 'M',
    assetSrc: '/provider-logos/meta.png',
  },
  generic: { key: 'generic', label: 'AI provider', glyph: 'AI' },
};

const providerBrandForModel = (option: Pick<ModelOptionSummary, 'id' | 'label'>): ProviderBrand => {
  const modelId = option.id.toLowerCase();
  const label = option.label.toLowerCase();

  if (modelId.startsWith('zai/') || label === 'sentinel') return PROVIDER_BRANDS.sentinel;
  if (modelId.startsWith('openai/')) return PROVIDER_BRANDS.openai;
  if (modelId.startsWith('anthropic/')) return PROVIDER_BRANDS.anthropic;
  if (modelId.startsWith('google/')) return PROVIDER_BRANDS.google;
  if (modelId.startsWith('xai/')) return PROVIDER_BRANDS.xai;
  if (modelId.startsWith('meta/')) return PROVIDER_BRANDS.meta;

  return PROVIDER_BRANDS.generic;
};

const ProviderMark = ({ brand, compact = false }: { brand: ProviderBrand; compact?: boolean }) => {
  const className = `model-selector-provider-mark model-selector-provider-mark--${brand.key} ${
    compact ? 'model-selector-provider-mark--compact' : ''
  }`;

  if (brand.assetSrc) {
    return (
      <span className={className} title={brand.label} aria-hidden="true">
        <img
          className="model-selector-provider-mark__image"
          src={brand.assetSrc}
          alt=""
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span className={className} title={brand.label} aria-hidden="true">
      <span className="model-selector-provider-mark__glyph">{brand.glyph}</span>
    </span>
  );
};

const ModelReasoningEffortMenu = ({
  levels,
  selectedEffort,
  defaultEffort,
  onChange,
}: {
  levels: string[];
  selectedEffort: string | null;
  defaultEffort?: string;
  onChange?: (effort: string) => void;
}) => {
  if (levels.length === 0 || !selectedEffort || !onChange) {
    return null;
  }

  return (
    <>
      <DropdownMenuSeparator className="model-selector-effort-separator" />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="model-selector-effort-trigger">
          <Gauge aria-hidden="true" />
          <span>Effort</span>
          <span className="model-selector-effort-trigger__value">
            {formatReasoningEffortLabel(selectedEffort)}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="model-selector-effort-menu" sideOffset={8}>
            <DropdownMenuLabel className="model-selector-effort-menu__header">
              <span>Reasoning effort</span>
              <span>Higher effort gives the model more room for difficult work.</span>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label="Reasoning effort"
              value={selectedEffort}
              onValueChange={onChange}
            >
              {levels.map((level) => (
                <DropdownMenuRadioItem
                  key={level}
                  value={level}
                  className="model-selector-effort-item"
                >
                  <span>{formatReasoningEffortLabel(level)}</span>
                  {level === defaultEffort ? (
                    <span className="model-selector-effort-item__default">Default</span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </>
  );
};

export const ModelSelectorControl: React.FC<ModelSelectorControlProps> = ({
  enabled,
  options,
  selectedModelId,
  disabled,
  loading,
  onSelect,
  selectedModelLabel,
  compact: compactValue,
  triggerRef,
  tooltip: tooltipValue,
  title,
  bare: bareValue,
  reasoningEffortLevels: reasoningEffortLevelsValue,
  selectedReasoningEffort: selectedReasoningEffortValue,
  onReasoningEffortChange,
}) => {
  const compact = defaultValue(compactValue, false);
  const tooltip = defaultValue<React.ReactNode>(tooltipValue, null);
  const bare = defaultValue(bareValue, false);
  const reasoningEffortLevels = defaultValue(reasoningEffortLevelsValue, []);
  const selectedReasoningEffort = defaultValue<string | null>(selectedReasoningEffortValue, null);
  const { hasOptions, activeOption, shouldRender, triggerLabel, triggerUsage, radioValue } =
    modelSelectorState(options, selectedModelId, selectedModelLabel, loading, enabled);

  if (!shouldRender) {
    return null;
  }

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className={`model-selector-trigger ${compact ? 'model-selector-trigger--compact' : ''} ${
          bare ? 'model-selector-trigger--bare' : ''
        }`}
        disabled={disabled || loading || !enabled || !hasOptions}
        title={title}
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
  );

  return (
    <DropdownMenu>
      {tooltip ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="top" className="prompt-control-tooltip">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}
      {hasOptions ? (
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="model-selector-menu rounded-lg"
        >
          <DropdownMenuLabel>Choose a model</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={radioValue} onValueChange={(value) => onSelect(value)}>
            {options.map((option) => {
              const optionUsage = formatUsageMultiple(option.usageMultiple);
              const providerBrand = providerBrandForModel(option);
              return (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="model-selector-item"
                >
                  <div className="model-selector-option">
                    <ProviderMark brand={providerBrand} />
                    <span className="sr-only">{providerBrand.label} provider</span>
                    <div className="model-selector-option__body">
                      <div className="model-selector-option__header">
                        <span className="model-selector-option__label">{option.label}</span>
                        {optionUsage ? (
                          <span className="model-selector-option__badge">{optionUsage}</span>
                        ) : null}
                      </div>
                      {option.description ? (
                        <span className="model-selector-option__description">
                          {option.description}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <ModelReasoningEffortMenu
            levels={reasoningEffortLevels}
            selectedEffort={selectedReasoningEffort}
            defaultEffort={activeOption?.defaultReasoningEffort}
            onChange={onReasoningEffortChange}
          />
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
};
