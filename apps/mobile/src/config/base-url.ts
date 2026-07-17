import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  extractHostFromCandidate,
  formatHostForHttpUrl,
  getObjectProp,
  getStringProp,
} from '@taskforceai/config/url-host';

import { mobileEnv } from './env';
import { createModuleLogger } from '../logger';

const LOCAL_BASE_URL = 'http://localhost:3000';
const PRODUCTION_BASE_URL = 'https://api.taskforceai.chat';
const PRODUCTION_SYNC_URL = 'https://sync.taskforceai.chat';

const isProdLikeUrl = (url?: string): boolean => Boolean(url && /api\.taskforceai\.chat/i.test(url));

type StringRecord = Record<string, unknown>;

const getExpoDevHost = (): string => {
  const constantsRecord: StringRecord = Constants;

  const expoConfig = constantsRecord['expoConfig'];
  const expoHostUri = getStringProp(expoConfig, 'hostUri');

  const manifest = constantsRecord['manifest'];
  const manifestDebuggerHost = getStringProp(manifest, 'debuggerHost');
  const manifestHostUri = getStringProp(manifest, 'hostUri');

  const manifest2 = constantsRecord['manifest2'];
  const manifest2Extra = getObjectProp(manifest2, 'extra');
  const expoGo = getObjectProp(manifest2Extra, 'expoGo');
  const expoGoDebuggerHost = getStringProp(expoGo, 'debuggerHost');
  const expoGoHostUri = getStringProp(expoGo, 'hostUri');

  const candidate =
    expoHostUri || manifestDebuggerHost || manifestHostUri || expoGoDebuggerHost || expoGoHostUri;

  if (!candidate) {
    return '';
  }

  const host = extractHostFromCandidate(candidate);
  if (!host) {
    return '';
  }

  if (/\.exp(\.direct)?/.test(host) || host.endsWith('.expo.dev')) {
    return '';
  }

  return host === '127.0.0.1' ? 'localhost' : host;
};

let warnedAboutMissingDevHost = false;
const logger = createModuleLogger('MobileBaseUrl');

const buildLocalDevUrl = (): string => {
  const detectedHost = getExpoDevHost();
  if (!detectedHost) {
    if (__DEV__ && !warnedAboutMissingDevHost && Platform.OS !== 'web') {
      logger.warn(
        'Unable to auto-detect a reachable dev server host. If you are testing on a physical device or tunnel, set EXPO_PUBLIC_API_URL=http://<your-ip>:3000.'
      );
      warnedAboutMissingDevHost = true;
    }
    return LOCAL_BASE_URL;
  }
  const port = mobileEnv.api.port;
  return `http://${formatHostForHttpUrl(detectedHost)}:${port}`;
};

/** Determine the default base URL for mobile API calls. */
export const getMobileBaseUrl = (): string => {
  const envUrl = mobileEnv.api.baseUrl;
  const forceProd = mobileEnv.api.forceProd;

  if (envUrl && (!__DEV__ || forceProd || !isProdLikeUrl(envUrl))) {
    return envUrl;
  }

  if (__DEV__) {
    return buildLocalDevUrl();
  }

  return envUrl && envUrl.length > 0 ? envUrl : PRODUCTION_BASE_URL;
};

/** Resolve the Sync service used by Remote without routing through Core. */
export const getMobileRemoteBaseUrl = (): string => {
  if (mobileEnv.sync.baseUrl) {
    return mobileEnv.sync.baseUrl;
  }

  if (__DEV__ && !mobileEnv.api.forceProd) {
    return getMobileBaseUrl();
  }

  return PRODUCTION_SYNC_URL;
};
