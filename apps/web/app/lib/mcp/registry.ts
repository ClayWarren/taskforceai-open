import {
  SharedMcpToolRegistry,
  formatMcpInventorySummary,
  type SharedMcpRegistrySnapshot,
} from '@taskforceai/react-core';
import type { PlatformRuntime } from '../platform/platform-interfaces';

import { loadAvailableWebMcpTools } from './inventory';
import type { WebMcpManager } from './manager';
import { WEB_MCP_SERVERS_CHANGED_EVENT } from './store';

export type WebMcpRegistrySnapshot = SharedMcpRegistrySnapshot;

export class WebMcpToolRegistry extends SharedMcpToolRegistry {
  constructor(
    private readonly runtime: PlatformRuntime,
    private readonly manager: WebMcpManager
  ) {
    super({
      loadInventory: () => loadAvailableWebMcpTools(this.runtime, this.manager),
      buildSnapshot: (inventory) => ({
        toolSummary: formatMcpInventorySummary(inventory),
        items: inventory.items,
      }),
    });
  }

  bindWindowEvents(): (() => void) | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const handleRefresh = () => {
      void this.refresh();
    };

    window.addEventListener('storage', handleRefresh);
    window.addEventListener(WEB_MCP_SERVERS_CHANGED_EVENT, handleRefresh);
    window.addEventListener('focus', handleRefresh);

    return () => {
      window.removeEventListener('storage', handleRefresh);
      window.removeEventListener(WEB_MCP_SERVERS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }
}
