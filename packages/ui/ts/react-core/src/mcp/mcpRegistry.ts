import type { McpRuntimeToolCatalogSnapshot } from '@taskforceai/client-core';
import { useEffect, useMemo, useState } from 'react';

import type { McpInventorySummary } from './mcpInventory';

export type SharedMcpRegistrySnapshot = McpRuntimeToolCatalogSnapshot;

type RegistryListener<TSnapshot> = (snapshot: TSnapshot) => void;

const EMPTY_SNAPSHOT: SharedMcpRegistrySnapshot = {
  toolSummary: null,
  items: [],
};

export class SharedMcpToolRegistry<
  TInventory extends McpInventorySummary = McpInventorySummary,
  TSnapshot extends SharedMcpRegistrySnapshot = SharedMcpRegistrySnapshot,
> {
  private snapshot: TSnapshot;
  private readonly listeners = new Set<RegistryListener<TSnapshot>>();
  private readonly buildSnapshot: (inventory: TInventory) => TSnapshot;
  private readonly loadInventory: () => Promise<TInventory>;
  private refreshId = 0;

  constructor(options: {
    loadInventory: () => Promise<TInventory>;
    buildSnapshot?: (inventory: TInventory) => TSnapshot;
    initialSnapshot?: TSnapshot;
  }) {
    this.loadInventory = options.loadInventory;
    this.buildSnapshot =
      options.buildSnapshot ??
      ((inventory) =>
        ({
          toolSummary: null,
          items: inventory.items,
        }) as TSnapshot);
    this.snapshot = options.initialSnapshot ?? (EMPTY_SNAPSHOT as TSnapshot);
  }

  getSnapshot(): TSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<TSnapshot> {
    const refreshId = this.refreshId + 1;
    this.refreshId = refreshId;
    const inventory = await this.loadInventory();
    const nextSnapshot = this.buildSnapshot(inventory);
    if (refreshId !== this.refreshId) {
      return nextSnapshot;
    }
    this.snapshot = nextSnapshot;
    this.emit();
    return this.snapshot;
  }

  subscribe(listener: RegistryListener<TSnapshot>): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export const useSharedMcpToolCatalog = <
  TManager extends { closeAll: () => Promise<void> },
  TSnapshot extends McpRuntimeToolCatalogSnapshot,
  TRegistry extends {
    subscribe: (listener: (snapshot: TSnapshot) => void) => () => void;
    refresh: () => Promise<unknown>;
  },
>(
  createManager: () => TManager,
  createRegistry: (manager: TManager) => TRegistry,
  bindRegistry: (registry: TRegistry) => (() => void) | null
): { manager: TManager; snapshot: TSnapshot } => {
  const manager = useMemo(() => createManager(), [createManager]);
  const registry = useMemo(() => createRegistry(manager), [createRegistry, manager]);
  const [snapshot, setSnapshot] = useState<TSnapshot>(EMPTY_SNAPSHOT as TSnapshot);

  useEffect(() => {
    return () => {
      void manager.closeAll();
    };
  }, [manager]);

  useEffect(() => {
    const unsubscribe = registry.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
    const unbind = bindRegistry(registry);
    void registry.refresh();

    return () => {
      unsubscribe();
      unbind?.();
    };
  }, [bindRegistry, registry]);

  return {
    manager,
    snapshot,
  };
};
