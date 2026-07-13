import { describe, expect, it } from 'bun:test';
import { formatToolName, formatDuration, formatStatus } from './formatters';

describe('formatToolName', () => {
  describe('known tool names', () => {
    it('formats search_web', () => {
      expect(formatToolName('search_web')).toBe('Web search');
    });

    it('formats execute_code', () => {
      expect(formatToolName('execute_code')).toBe('Run code');
    });

    it('formats read_file', () => {
      expect(formatToolName('read_file')).toBe('Read file');
    });

    it('formats write_file', () => {
      expect(formatToolName('write_file')).toBe('Write file');
    });

    it('formats mark_task_complete', () => {
      expect(formatToolName('mark_task_complete')).toBe('Mark task complete');
    });

    it('formats hybrid.localReviewer', () => {
      expect(formatToolName('hybrid.localReviewer')).toBe('Local reviewer');
    });

    it('is case-insensitive for known tools', () => {
      expect(formatToolName('SEARCH_WEB')).toBe('Web search');
      expect(formatToolName('Search_Web')).toBe('Web search');
    });
  });

  describe('unknown tool names', () => {
    it('returns "Tool" for empty string', () => {
      expect(formatToolName('')).toBe('Tool');
      expect(formatToolName('   ')).toBe('Tool');
    });

    it('returns "Tool" for undefined', () => {
      expect(formatToolName(undefined)).toBe('Tool');
    });

    it('formats snake_case to title case', () => {
      expect(formatToolName('my_custom_tool')).toBe('My Custom Tool');
    });

    it('formats kebab-case to title case', () => {
      expect(formatToolName('my-custom-tool')).toBe('My Custom Tool');
    });

    it('formats dot.case to title case', () => {
      expect(formatToolName('my.custom.tool')).toBe('My Custom Tool');
    });

    it('returns short names uppercase', () => {
      expect(formatToolName('api')).toBe('API');
      expect(formatToolName('cli')).toBe('CLI');
    });

    it('returns longer names in title case', () => {
      expect(formatToolName('database query')).toBe('Database Query');
    });

    it('handles multiple consecutive separators', () => {
      expect(formatToolName('my__tool')).toBe('My Tool');
      expect(formatToolName('my--tool')).toBe('My Tool');
    });

    it('returns original if no valid parts after separator replacement', () => {
      expect(formatToolName('___')).toBe('___');
    });
  });
});

describe('formatDuration', () => {
  it('returns null for undefined', () => {
    expect(formatDuration(undefined)).toBe(null);
  });

  it('returns null for null', () => {
    expect(formatDuration(null)).toBe(null);
  });

  it('returns null for zero', () => {
    expect(formatDuration(0)).toBe(null);
  });

  it('returns null for negative values', () => {
    expect(formatDuration(-100)).toBe(null);
  });

  it('returns null for non-finite values', () => {
    expect(formatDuration(Infinity)).toBe(null);
    expect(formatDuration(NaN)).toBe(null);
  });

  it('formats milliseconds under 1 second', () => {
    expect(formatDuration(100)).toBe('100 ms');
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(999)).toBe('999 ms');
  });

  it('rounds milliseconds', () => {
    expect(formatDuration(123.4)).toBe('123 ms');
    expect(formatDuration(123.5)).toBe('124 ms');
  });

  it('formats seconds with 1 decimal for values under 10', () => {
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(5500)).toBe('5.5 s');
    expect(formatDuration(9999)).toBe('10.0 s');
  });

  it('formats seconds without decimal for values >= 10', () => {
    expect(formatDuration(10000)).toBe('10 s');
    expect(formatDuration(15000)).toBe('15 s');
    expect(formatDuration(60000)).toBe('60 s');
  });
});

describe('formatStatus', () => {
  it('returns Failed for error message', () => {
    const result = formatStatus({ error: 'Something went wrong' });
    expect(result).toEqual({ label: 'Failed', color: '#f87171' });
  });

  it('returns Failed for success false', () => {
    const result = formatStatus({ success: false });
    expect(result).toEqual({ label: 'Failed', color: '#f87171' });
  });

  it('returns Failed for error with success true (error takes precedence)', () => {
    const result = formatStatus({ success: true, error: 'Still failed' });
    expect(result).toEqual({ label: 'Failed', color: '#f87171' });
  });

  it('returns Success for success true', () => {
    const result = formatStatus({ success: true });
    expect(result).toEqual({ label: 'Success', color: '#34d399' });
  });

  it('returns Running for running tool events', () => {
    const result = formatStatus({ success: true, status: 'running' });
    expect(result).toEqual({ label: 'Running', color: '#facc15' });
  });

  it('returns Failed when success is undefined (falsy)', () => {
    const result = formatStatus({});
    expect(result).toEqual({ label: 'Failed', color: '#f87171' });
  });

  it('returns Failed for null error without success (success is falsy)', () => {
    const result = formatStatus({ error: null });
    expect(result).toEqual({ label: 'Failed', color: '#f87171' });
  });
});
