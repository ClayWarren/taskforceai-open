import { describe, expect, it, vi } from 'bun:test';
import {
  marketingBuildAssetsDir,
  marketingDevServerPort,
  routeFileIgnorePattern,
  shouldSuppressBuildWarning,
} from './lib/vite-options';

describe('marketing Vite config', () => {
  it('configures TanStack route ignores and the marketing dev server port', () => {
    expect(routeFileIgnorePattern).toBe('\\.(test|spec)\\.[tj]sx?$');
    expect(marketingDevServerPort).toBe(3001);
  });

  it('uses the static build asset directory and suppresses only the known cssom eval warning', () => {
    expect(marketingBuildAssetsDir).toBe('_build');

    const warn = vi.fn();
    expect(
      shouldSuppressBuildWarning({
        code: 'EVAL',
        id: '/repo/node_modules/@acemir/cssom/lib/errorUtils.js',
      })
    ).toBe(true);

    const unexpectedWarning = {
      code: 'CIRCULAR_DEPENDENCY',
      message: 'Circular dependency',
    };
    if (!shouldSuppressBuildWarning(unexpectedWarning)) {
      warn(unexpectedWarning);
    }
    expect(warn).toHaveBeenCalledWith(unexpectedWarning);
  });
});
