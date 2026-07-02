import { type EnvSource, type WebEnv, loadWebEnv } from '@taskforceai/shared/config/server';

// Guard against process being undefined in browser
const processEnv: EnvSource = typeof process !== 'undefined' ? process.env : ({} as EnvSource);

const { env, validateEnv } = loadWebEnv({
  env: processEnv,
  isTestEnv: processEnv['NODE_ENV'] === 'test',
  isBuildTime: processEnv['NEXT_PHASE'] === 'phase-production-build',
  isClientSide: typeof window !== 'undefined',
});

export { env, validateEnv };
export type Env = WebEnv;
