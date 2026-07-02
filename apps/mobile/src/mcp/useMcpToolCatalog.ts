import type { McpRuntimeToolCatalogSnapshot } from '@taskforceai/shared';
import { useSharedMcpToolCatalog } from '@taskforceai/react-core';

import { MobileMcpManager } from './manager';
import { MobileMcpToolRegistry } from './registry';

const createManager = () => new MobileMcpManager();
const createRegistry = (manager: MobileMcpManager) => new MobileMcpToolRegistry(manager);
const bindRegistry = (registry: MobileMcpToolRegistry) => registry.bindStore();

export const useMobileMcpToolCatalog = (): {
  manager: MobileMcpManager;
  snapshot: McpRuntimeToolCatalogSnapshot;
} =>
  useSharedMcpToolCatalog(
    createManager,
    createRegistry,
    bindRegistry
  );
