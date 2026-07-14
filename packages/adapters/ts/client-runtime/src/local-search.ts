import Fuse, { type IFuseOptions } from 'fuse.js';

import type { SidebarSearchItem } from '@taskforceai/presenters/sidebar/view-model';

export type SearchableItem = SidebarSearchItem;

const cloneSearchableItem = (item: SearchableItem): SearchableItem => ({
  id: item.id,
  title: item.title,
  content: item.content,
  ...(item.tags ? { tags: [...item.tags] } : {}),
});

const areItemsEqual = (left: SearchableItem, right: SearchableItem): boolean => {
  if (left.id !== right.id || left.title !== right.title || left.content !== right.content) {
    return false;
  }

  if (!left.tags && !right.tags) {
    return true;
  }
  if (!left.tags || !right.tags || left.tags.length !== right.tags.length) {
    return false;
  }

  for (let i = 0; i < left.tags.length; i += 1) {
    if (left.tags[i] !== right.tags[i]) {
      return false;
    }
  }

  return true;
};

export class LocalSearch {
  private fuse: Fuse<SearchableItem> | null = null;
  private readonly items: Map<string, SearchableItem> = new Map();
  private readonly options: IFuseOptions<SearchableItem> = {
    keys: ['title', 'content', 'tags'],
    threshold: 0.3,
    includeScore: true,
  };

  private rebuildIndex(): void {
    const data = Array.from(this.items.values());
    if (data.length === 0) {
      this.fuse = null;
      return;
    }
    this.fuse = new Fuse(data, this.options);
  }

  initialize(items: SearchableItem[]) {
    let shouldRebuild = false;
    const nextIds = new Set(items.map((item) => item.id));

    for (const existingId of this.items.keys()) {
      if (!nextIds.has(existingId)) {
        this.items.delete(existingId);
        shouldRebuild = true;
      }
    }

    for (const item of items) {
      const existing = this.items.get(item.id);
      if (!existing || !areItemsEqual(existing, item)) {
        this.items.set(item.id, cloneSearchableItem(item));
        shouldRebuild = true;
      }
    }

    if (shouldRebuild || !this.fuse) {
      this.rebuildIndex();
    }
  }

  search(query: string): SearchableItem[] {
    if (!this.fuse || !query.trim()) return [];
    return this.fuse.search(query).map((result) => cloneSearchableItem(result.item));
  }

  addItem(item: SearchableItem) {
    const existing = this.items.has(item.id);
    const normalizedItem = cloneSearchableItem(item);
    this.items.set(item.id, normalizedItem);
    if (this.fuse) {
      const removed = this.fuse.remove((doc) => doc.id === item.id);
      if (existing && removed.length === 0) {
        this.rebuildIndex();
        return;
      }
      this.fuse.add(normalizedItem);
    } else {
      this.rebuildIndex();
    }
  }

  removeItem(id: string) {
    if (!this.items.delete(id)) {
      return;
    }
    if (this.fuse) {
      this.fuse.remove((doc) => doc.id === id);
    }
    if (this.items.size === 0) {
      this.fuse = null;
    }
  }
}

export const localSearch = new LocalSearch();
