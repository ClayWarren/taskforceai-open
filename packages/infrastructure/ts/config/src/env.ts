import { type WebEnv, loadWebEnv } from './server';

const { env, validateEnv } = loadWebEnv({
  env: typeof process !== 'undefined' ? process.env : {},
  isTestEnv: typeof process !== 'undefined' ? process.env?.['NODE_ENV'] === 'test' : false,
  isBuildTime:
    typeof process !== 'undefined'
      ? process.env?.['NEXT_PHASE'] === 'phase-production-build'
      : false,
  isClientSide: typeof window !== 'undefined',
});

const isDevelopment = env.NODE_ENV === 'development';
const isTest = env.NODE_ENV === 'test';
const isProduction = env.NODE_ENV === 'production';
const isBrowser = typeof window !== 'undefined';

export { env, validateEnv, isDevelopment, isTest, isProduction, isBrowser };
export type Env = WebEnv;
