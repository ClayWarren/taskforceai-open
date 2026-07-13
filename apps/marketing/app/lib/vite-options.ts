type RollupWarning = {
  code?: string;
  id?: string;
};

export const routeFileIgnorePattern = '\\.(test|spec)\\.[tj]sx?$';
export const marketingDevServerPort = 3001;
export const marketingBuildAssetsDir = '_build';

export function shouldSuppressBuildWarning(warning: RollupWarning): boolean {
  return (
    warning.code === 'EVAL' && warning.id?.includes('@acemir/cssom/lib/errorUtils.js') === true
  );
}
