export type SearchIndexItem = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
};

export interface SearchIndex {
  addItem(item: SearchIndexItem): void;
  removeItem(id: string): void;
}

/**
 * No-op search index for platforms that don't need it or provide their own.
 */
export const createNoopSearchIndex = (): SearchIndex => ({
  addItem: () => {},
  removeItem: () => {},
});
