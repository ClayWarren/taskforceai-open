type LoginPlan = 'pro' | 'super';

export type LoginQuery = {
  callbackUrl: string | null;
  error: string | null;
  plan: LoginPlan | null;
};

const normalizeInternalCallback = (callbackUrl: string, origin: string): string | null => {
  try {
    const resolved = new URL(callbackUrl, origin);
    if (resolved.origin !== origin) {
      return null;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
};

const isValidPlan = (plan: string | null): plan is LoginPlan => plan === 'pro' || plan === 'super';

const applyPlanToPath = (path: string, plan: LoginPlan, origin: string): string => {
  const callback = new URL(path, origin);
  callback.searchParams.set('plan', plan);
  return callback.pathname + callback.search + callback.hash;
};

export const parseLoginQuery = (searchParams: URLSearchParams): LoginQuery => {
  const rawPlan = searchParams.get('plan');

  return {
    callbackUrl: searchParams.get('callbackUrl'),
    error: searchParams.get('error'),
    plan: isValidPlan(rawPlan) ? rawPlan : null,
  };
};

export const buildLoginCallbackUrl = (query: LoginQuery, origin: string): string | undefined => {
  if (query.callbackUrl) {
    const safeCallback = normalizeInternalCallback(query.callbackUrl, origin);
    if (!safeCallback) {
      return undefined;
    }
    if (query.plan) {
      return applyPlanToPath(safeCallback, query.plan, origin);
    }
    return safeCallback;
  }

  if (query.plan) {
    return `/?plan=${query.plan}`;
  }

  return undefined;
};

export const resolveLoginRedirectTarget = (query: LoginQuery, origin: string): string => {
  if (query.callbackUrl) {
    const safeCallback = normalizeInternalCallback(query.callbackUrl, origin);
    if (safeCallback) {
      if (query.plan) {
        return applyPlanToPath(safeCallback, query.plan, origin);
      }
      return safeCallback;
    }
  }

  if (query.plan) {
    return `/?plan=${query.plan}`;
  }

  return '/';
};

export const getLoginErrorMessage = (errorCode: string | null): string => {
  if (!errorCode) {
    return '';
  }

  if (errorCode === 'CredentialsSignin') {
    return 'Invalid username or password';
  }
  if (errorCode === 'OAuthSignin') {
    return 'OAuth sign-in failed. Please try again.';
  }
  if (errorCode === 'OAuthCallback') {
    return 'OAuth callback error. Please try again.';
  }
  if (errorCode === 'OAuthAccountNotLinked') {
    return 'This email is already associated with another login method. Please sign in using your original method.';
  }
  if (errorCode === 'ConfigurationError' || errorCode === 'AccessDenied') {
    return 'Access denied or service configuration error. Please ensure you have permission to access this application.';
  }
  if (errorCode === 'sessionExpired') {
    return 'Your session has expired. Please sign in again to continue.';
  }
  return `Authentication error (${errorCode || 'unknown'}). Please try again.`;
};
