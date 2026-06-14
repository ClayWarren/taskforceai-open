import { describe, expect, it } from 'bun:test';
import {
  clamp,
  buildAgentVisualizations,
  computeOverallProgress,
  createAgentVisualization,
  deriveIndicatorState,
  estimateStreamingProgress,
  formatElapsed,
  parseAgentProgress,
  resolveAgentStateLabel,
  smoothStreamingAgentProgress,
  splitAgentResultLines,
} from './agent-progress';

describe('clamp', () => {
  it('returns value when within bounds', () => {
    expect(clamp(0.5)).toBe(0.5);
  });

  it('returns min when value is below', () => {
    expect(clamp(-0.5)).toBe(0);
  });

  it('returns max when value is above', () => {
    expect(clamp(1.5)).toBe(1);
  });

  it('respects custom bounds', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe('formatElapsed', () => {
  it('returns 0s for zero or negative', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(-5)).toBe('0s');
  });

  it('formats seconds only when under a minute', () => {
    expect(formatElapsed(30)).toBe('30s');
    expect(formatElapsed(59)).toBe('59s');
  });

  it('formats minutes and seconds when over a minute', () => {
    expect(formatElapsed(60)).toBe('1m 00s');
    expect(formatElapsed(90)).toBe('1m 30s');
    expect(formatElapsed(125)).toBe('2m 05s');
  });
});

describe('parseAgentProgress', () => {
  describe('with explicit progress', () => {
    it('returns clamped explicit value', () => {
      const result = parseAgentProgress('ANY', 0.75);
      expect(result.progress).toBe(0.75);
      expect(result.label).toBe('75%');
      expect(result.state).toBe('running');
    });

    it('marks 100% as completed', () => {
      const result = parseAgentProgress('ANY', 1);
      expect(result.progress).toBe(1);
      expect(result.state).toBe('completed');
    });

    it('clamps out-of-bounds values', () => {
      expect(parseAgentProgress('ANY', -0.5).progress).toBe(0);
      expect(parseAgentProgress('ANY', 1.5).progress).toBe(1);
    });

    it('ignores NaN explicit values', () => {
      const result = parseAgentProgress('QUEUED', NaN);
      expect(result.state).toBe('queued');
    });
  });

  describe('PROGRESS: prefix', () => {
    it('parses PROGRESS:0.5 format', () => {
      const result = parseAgentProgress('PROGRESS:0.5');
      expect(result.progress).toBe(0.5);
      expect(result.label).toBe('50%');
      expect(result.state).toBe('running');
    });

    it('parses PROGRESS:0.8 format', () => {
      const result = parseAgentProgress('PROGRESS:0.8');
      expect(result.progress).toBe(0.8);
      expect(result.label).toBe('80%');
    });
  });

  describe('failure states', () => {
    it('recognizes FAILED', () => {
      const result = parseAgentProgress('FAILED');
      expect(result.state).toBe('failed');
      expect(result.label).toBe('Failed');
    });

    it('recognizes ERROR', () => {
      const result = parseAgentProgress('ERROR');
      expect(result.state).toBe('failed');
    });

    it('recognizes FAILED: reason', () => {
      const result = parseAgentProgress('FAILED: timeout');
      expect(result.state).toBe('failed');
    });
  });

  describe('completion states', () => {
    it('recognizes COMPLETED', () => {
      const result = parseAgentProgress('COMPLETED');
      expect(result.state).toBe('completed');
    });

    it('recognizes COMPLETE', () => {
      const result = parseAgentProgress('COMPLETE');
      expect(result.state).toBe('completed');
    });

    it('recognizes DONE', () => {
      const result = parseAgentProgress('DONE');
      expect(result.state).toBe('completed');
    });

    it('recognizes SUCCESS', () => {
      const result = parseAgentProgress('SUCCESS');
      expect(result.state).toBe('completed');
    });
  });

  describe('running states', () => {
    it('recognizes PROCESSING', () => {
      const result = parseAgentProgress('PROCESSING');
      expect(result.state).toBe('running');
      expect(result.progress).toBe(0.6);
    });

    it('recognizes INITIALIZING', () => {
      const result = parseAgentProgress('INITIALIZING');
      expect(result.state).toBe('running');
      expect(result.progress).toBe(0.3);
    });

    it('recognizes RUNNING', () => {
      const result = parseAgentProgress('RUNNING');
      expect(result.state).toBe('running');
      expect(result.progress).toBe(0.5);
    });

    it('recognizes WORKING', () => {
      const result = parseAgentProgress('WORKING');
      expect(result.state).toBe('running');
    });
  });

  describe('queued states', () => {
    it('recognizes QUEUED', () => {
      const result = parseAgentProgress('QUEUED');
      expect(result.state).toBe('queued');
      expect(result.progress).toBe(0.05);
    });

    it('recognizes WAITING', () => {
      const result = parseAgentProgress('WAITING');
      expect(result.state).toBe('queued');
    });
  });

  describe('unknown status', () => {
    it('returns title-cased label for unknown status', () => {
      const result = parseAgentProgress('some custom status');
      expect(result.state).toBe('running');
      expect(result.label).toBe('Some Custom Status');
      expect(result.progress).toBe(0.4);
    });

    it('handles empty string', () => {
      const result = parseAgentProgress('');
      expect(result.state).toBe('running');
      expect(result.label).toBe('Queued');
    });
  });
});

describe('computeOverallProgress', () => {
  it('returns completed progress for completed snapshots', () => {
    expect(computeOverallProgress([{ progressValue: 0.2 }], true)).toBe(1);
  });

  it('returns zero when there are no agents', () => {
    expect(computeOverallProgress([])).toBe(0);
  });

  it('averages agent progress and clamps the result', () => {
    expect(computeOverallProgress([{ progressValue: 0.25 }, { progressValue: 0.75 }])).toBe(0.5);
    expect(computeOverallProgress([{ progressValue: 2 }, { progressValue: 1 }])).toBe(1);
  });
});

describe('streaming progress smoothing', () => {
  it('advances sparse queued updates without reaching completion', () => {
    const initial = estimateStreamingProgress(0.05, 0, 'queued');
    const later = estimateStreamingProgress(0.05, 12, 'queued');

    expect(initial).toBeCloseTo(0.05);
    expect(later).toBeGreaterThan(0.05);
    expect(later).toBeLessThan(1);
  });

  it('caps active running estimates below terminal completion', () => {
    expect(estimateStreamingProgress(0.5, 120, 'running')).toBeCloseTo(0.924, 3);
  });

  it('graduates stale queued slots into active running estimates', () => {
    expect(estimateStreamingProgress(0.05, 90, 'queued')).toBeGreaterThan(0.75);
  });

  it('keeps terminal progress authoritative', () => {
    expect(estimateStreamingProgress(1, 1, 'completed')).toBe(1);
    expect(estimateStreamingProgress(1, 1, 'failed')).toBe(1);
  });

  it('creates display-only smoothed agent progress while streaming', () => {
    const agent = createAgentVisualization({ status: 'QUEUED', agent_id: 0 }, 0);
    const smoothed = smoothStreamingAgentProgress(agent, 12, true);

    expect(smoothed.progressValue).toBeGreaterThan(agent.progressValue);
    expect(smoothed.progressValue).toBeLessThan(1);
    expect(smoothed.displayStatus).toMatch(/%$/);
    expect(agent.progressValue).toBe(0.05);
  });
});

describe('deriveIndicatorState', () => {
  it('returns completed for completed snapshots and non-streaming views', () => {
    expect(deriveIndicatorState([{ state: 'running' }], true, true)).toBe('completed');
    expect(deriveIndicatorState([{ state: 'running' }], false, false)).toBe('completed');
  });

  it('prioritizes failed agents while streaming', () => {
    expect(deriveIndicatorState([{ state: 'running' }, { state: 'failed' }], false, true)).toBe(
      'failed'
    );
  });

  it('keeps the indicator active while completed streaming agents synthesize the final answer', () => {
    expect(
      deriveIndicatorState([{ state: 'completed' }, { state: 'completed' }], false, true)
    ).toBe('running');
  });

  it('returns running when any streaming agent is running', () => {
    expect(deriveIndicatorState([{ state: 'queued' }, { state: 'running' }], false, true)).toBe(
      'running'
    );
  });

  it('falls back to queued while streaming without active agents', () => {
    expect(deriveIndicatorState([], false, true)).toBe('queued');
    expect(deriveIndicatorState([{ state: 'queued' }], false, true)).toBe('queued');
  });
});

describe('agent visualizations', () => {
  it('builds sorted visualization records from status snapshots', () => {
    expect(
      buildAgentVisualizations([
        { agent_id: 2, status: 'RUNNING', model: 'openai/gpt-5' },
        { agent_id: 0, status: 'COMPLETED', result: 'done' },
      ])
    ).toEqual([
      {
        id: 0,
        label: 'Agent 1',
        status: 'COMPLETED',
        displayStatus: 'Completed',
        progressValue: 1,
        result: 'done',
        state: 'completed',
      },
      {
        id: 2,
        label: 'Agent 3',
        status: 'RUNNING',
        displayStatus: 'Running',
        progressValue: 0.5,
        state: 'running',
        model: 'openai/gpt-5',
      },
    ]);
  });

  it('supports uppercase labels for web visualizations', () => {
    expect(createAgentVisualization({ status: 'QUEUED' }, 1, { uppercaseLabel: true }).label).toBe(
      'AGENT 2'
    );
  });

  it('labels agent states and splits non-empty result lines', () => {
    expect(resolveAgentStateLabel({ state: 'failed' })).toBe('Failed');
    expect(resolveAgentStateLabel({ state: 'completed' })).toBe('Completed');
    expect(resolveAgentStateLabel({ state: 'running' })).toBe('In progress');
    expect(resolveAgentStateLabel({ state: 'queued' })).toBe('Queued');
    expect(splitAgentResultLines(' one\n\n two ')).toEqual(['one', 'two']);
    expect(splitAgentResultLines()).toEqual([]);
  });
});
