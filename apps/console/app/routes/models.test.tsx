import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

const mockUseSuspenseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: mockUseSuspenseQuery,
}));

import { Route } from './models';

const buildModels = (overrides: Partial<ModelSelectorResponse> = {}): ModelSelectorResponse => ({
  enabled: true,
  defaultModelId: 'zai/glm-5.2',
  options: [
    {
      id: 'zai/glm-5.2',
      label: 'Sentinel',
      badge: 'Default',
      description: 'Flagship reasoning model',
      usageMultiple: 1,
    },
    {
      id: 'xai/grok-4.3',
      label: 'Grok 4.3',
      badge: 'Pro',
      description: 'Heavy reasoning model',
      usageMultiple: 2,
    },
    {
      id: 'anthropic/claude-opus-4',
      label: 'Claude Opus',
      badge: 'Pro',
      description: 'High capability model',
      usageMultiple: 1.5,
    },
    {
      id: 'openai/gpt-5-preview',
      label: 'GPT-5 Preview',
      badge: 'Preview',
      description: 'Next generation model',
      usageMultiple: 2,
    },
    {
      id: 'taskforce/heavy-reasoning',
      label: 'Heavy Reasoning',
      badge: 'Internal',
      description: 'Deep planning model',
      usageMultiple: 3,
    },
    {
      id: 'xai/grok-imagine-video',
      label: 'Grok Imagine Video',
      badge: 'Video',
      description: 'Video generation model',
      usageMultiple: 4,
    },
    {
      id: 'custom/default',
      label: 'Default Shield',
      badge: 'Legacy',
      description: 'Fallback icon styling',
      usageMultiple: 1.2,
    },
  ],
  ...overrides,
});

const getModelsPageComponent = (): ComponentType => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType; errorComponent?: ComponentType };
  };
  const ModelsPage = route.options?.component ?? route.component;
  if (!ModelsPage) {
    throw new Error('models route component is unavailable');
  }
  return ModelsPage;
};

const getModelsErrorComponent = (): ComponentType<{ error: Error }> => {
  const route = Route as unknown as {
    errorComponent?: ComponentType<{ error: Error }>;
    options?: { errorComponent?: ComponentType<{ error: Error }> };
  };
  const ErrorComponent = route.options?.errorComponent ?? route.errorComponent;
  if (!ErrorComponent) {
    throw new Error('models route error component is unavailable');
  }
  return ErrorComponent;
};

describe('models route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSuspenseQuery.mockReturnValue({ data: buildModels() });
  });

  it('renders model cards with capability indicators and default badge', () => {
    const ModelsPage = getModelsPageComponent();
    render(<ModelsPage />);

    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByText('Sentinel')).toBeInTheDocument();
    expect(screen.getByText('Grok 4.3')).toBeInTheDocument();
    expect(screen.getByText('Claude Opus')).toBeInTheDocument();
    expect(screen.getByText('GPT-5 Preview')).toBeInTheDocument();
    expect(screen.getByText('Heavy Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Grok Imagine Video')).toBeInTheDocument();
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
    expect(screen.getByText(/Enterprise customers/i)).toBeInTheDocument();
  });

  it('renders the route error state when model loading fails', () => {
    const ErrorComponent = getModelsErrorComponent();
    render(<ErrorComponent error={new Error('Models API unavailable')} />);

    expect(screen.getByText('Failed to load models')).toBeInTheDocument();
    expect(screen.getByText('Models API unavailable')).toBeInTheDocument();
  });
});
