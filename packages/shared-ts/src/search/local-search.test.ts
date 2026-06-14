import { describe, expect, it, beforeEach } from 'bun:test';
import { LocalSearch, localSearch, type SearchableItem } from './local-search';

describe('LocalSearch', () => {
  let search: LocalSearch;

  beforeEach(() => {
    search = new LocalSearch();
  });

  const sampleItems: SearchableItem[] = [
    { id: '1', title: 'Hello World', content: 'A greeting message', tags: ['greeting', 'hello'] },
    { id: '2', title: 'Goodbye', content: 'A farewell message', tags: ['farewell', 'bye'] },
    {
      id: '3',
      title: 'TypeScript Guide',
      content: 'Learn TypeScript basics',
      tags: ['programming', 'typescript'],
    },
  ];

  describe('initialize', () => {
    it('initializes with items', () => {
      search.initialize(sampleItems);
      const results = search.search('hello');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe('1');
    });

    it('replaces the existing dataset snapshot', () => {
      search.initialize([sampleItems[0]!]);
      search.initialize([sampleItems[1]!]);
      expect(search.search('goodbye').length).toBeGreaterThan(0);
      expect(search.search('hello')).toEqual([]);
    });

    it('replaces existing item with same id', () => {
      search.initialize([{ id: '1', title: 'Old Title', content: 'Old content' }]);
      search.initialize([{ id: '1', title: 'New Title', content: 'New content' }]);
      const results = search.search('New Title');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.title).toBe('New Title');
    });

    it('handles empty array', () => {
      search.initialize([]);
      expect(search.search('test')).toEqual([]);
    });

    it('does not rebuild index if items are identical', () => {
      const item = { id: '1', title: 'Test', content: 'Content' };
      search.initialize([item]);
      search.initialize([item]);
      expect(search.search('Test').length).toBeGreaterThan(0);
    });

    it('rebuilds index when an item is mutated in place and re-initialized', () => {
      const item = { id: '1', title: 'Initial Title', content: 'Content' };
      search.initialize([item]);

      item.title = 'Updated Title';
      search.initialize([item]);

      expect(search.search('Updated').some((result) => result.id === '1')).toBe(true);
      expect(search.search('Initial').some((result) => result.id === '1')).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      search.initialize(sampleItems);
    });

    it('finds items by title', () => {
      const results = search.search('Hello');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '1')).toBe(true);
    });

    it('finds items by content', () => {
      const results = search.search('farewell');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '2')).toBe(true);
    });

    it('finds items by tag', () => {
      const results = search.search('typescript');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === '3')).toBe(true);
    });

    it('returns empty array for empty query', () => {
      expect(search.search('')).toEqual([]);
      expect(search.search('   ')).toEqual([]);
    });

    it('returns empty array when no index', () => {
      const emptySearch = new LocalSearch();
      expect(emptySearch.search('test')).toEqual([]);
    });

    it('returns empty array for no matches', () => {
      expect(search.search('nonexistent xyz')).toEqual([]);
    });

    it('returns cloned search results to prevent external index mutation', () => {
      const first = search.search('hello')[0];
      expect(first).toBeDefined();
      if (!first) {
        return;
      }

      first.title = 'Mutated Title';

      expect(search.search('Mutated Title')).toEqual([]);
      expect(search.search('Hello')[0]?.title).toBe('Hello World');
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      search.initialize([sampleItems[0]!]);
    });

    it('adds new item to index', () => {
      search.addItem(sampleItems[1]!);
      expect(search.search('goodbye').length).toBeGreaterThan(0);
    });

    it('updates existing item with same id', () => {
      search.addItem({ id: '1', title: 'Updated', content: 'Updated content' });
      const results = search.search('Updated');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.title).toBe('Updated');
    });

    it('creates index if empty', () => {
      const emptySearch = new LocalSearch();
      emptySearch.addItem(sampleItems[0]!);
      expect(emptySearch.search('Hello').length).toBeGreaterThan(0);
    });
  });

  describe('removeItem', () => {
    beforeEach(() => {
      search.initialize(sampleItems);
    });

    it('removes item from index', () => {
      search.removeItem('1');
      const results = search.search('Hello');
      expect(results.every((r) => r.id !== '1')).toBe(true);
    });

    it('does nothing for non-existent id', () => {
      search.removeItem('nonexistent');
      expect(search.search('Hello').length).toBeGreaterThan(0);
    });

    it('clears fuse when all items removed', () => {
      search.removeItem('1');
      search.removeItem('2');
      search.removeItem('3');
      expect(search.search('test')).toEqual([]);
    });
  });
});

describe('localSearch singleton', () => {
  it('is an instance of LocalSearch', () => {
    expect(localSearch).toBeInstanceOf(LocalSearch);
  });
});
