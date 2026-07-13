import {
  SharedMcpToolRegistry,
  formatMcpInventorySummary,
} from '@taskforceai/react-core';
import { loadAvailableMobileMcpTools } from './inventory';
import type { MobileMcpInventorySummary } from './inventory';
import type { MobileMcpManager } from './manager';
import { subscribeMobileMcpServers } from './store';

export type MobileMcpRegistrySnapshot = {
  toolSummary: string | null;
  inventory: MobileMcpInventorySummary;
  items: MobileMcpInventorySummary['items'];
};

const EMPTY_INVENTORY: MobileMcpInventorySummary = {
  serverCount: 0,
  toolCount: 0,
  items: [],
};

export class MobileMcpToolRegistry extends SharedMcpToolRegistry<
  MobileMcpInventorySummary,
  MobileMcpRegistrySnapshot
> {
  constructor(private readonly manager: MobileMcpManager) {
    super({
      loadInventory: () => loadAvailableMobileMcpTools(this.manager),
      initialSnapshot: {
        toolSummary: null,
        inventory: EMPTY_INVENTORY,
        items: [],
      },
      buildSnapshot: (inventory: MobileMcpInventorySummary) => ({
        toolSummary: formatMcpInventorySummary(inventory),
        inventory,
        items: inventory.items,
      }),
    });
  }

  bindStore(): () => void {
    return subscribeMobileMcpServers(() => {
      void this.refresh();
    });
  }
}
