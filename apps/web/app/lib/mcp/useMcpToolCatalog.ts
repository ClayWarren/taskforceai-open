'use client';

import { useSharedMcpToolCatalog } from '@taskforceai/react-core';
import { useCallback } from 'react';

import type { PlatformRuntime } from '../platform/platform-interfaces';
import { WebMcpManager } from './manager';
import { WebMcpToolRegistry } from './registry';

export const useWebMcpToolCatalog = (
  runtime: PlatformRuntime
): {
  manager: WebMcpManager;
  snapshot: import('@taskforceai/client-core').McpRuntimeToolCatalogSnapshot;
} => {
  const createManager = useCallback(() => new WebMcpManager(), []);
  const createRegistry = useCallback(
    (manager: WebMcpManager) => new WebMcpToolRegistry(runtime, manager),
    [runtime]
  );
  const bindRegistry = useCallback(
    (registry: WebMcpToolRegistry) => registry.bindWindowEvents(),
    []
  );

  return useSharedMcpToolCatalog(createManager, createRegistry, bindRegistry);
};
