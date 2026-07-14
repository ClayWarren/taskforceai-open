import { type EnvSource, loadWebEnv } from '@taskforceai/config/server';

// Guard against process being undefined in browser
const processEnv: EnvSource = typeof process !== 'undefined' ? process.env : ({} as EnvSource);

const { env } = loadWebEnv({
  env: processEnv,
  isTestEnv: processEnv['NODE_ENV'] === 'test',
  isBuildTime: processEnv['NEXT_PHASE'] === 'phase-production-build',
  isClientSide: typeof window !== 'undefined',
});

export { env };
