import { buildUserState } from '@taskforceai/contracts/auth/auth-service';
import type { InitialAuthSnapshot } from '@taskforceai/contracts/auth/AuthProvider';
import {
  authenticatedUserSchema,
  modelSelectorResponseSchema,
  type AuthenticatedUser,
  type ModelSelectorResponse,
} from '@taskforceai/contracts/contracts';
import { PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/shared';
import { z } from 'zod';

const BOOTSTRAP_REQUEST_TIMEOUT_MS = 800;

const sessionBootstrapSchema = z.object({
  user: z
    .object({
      name: z.string().nullable().optional(),
      email: z.string().min(1),
      image: z.string().nullable().optional(),
    })
    .optional(),
  expires: z.string().optional(),
});

export interface RootBootstrapSnapshot {
  auth: InitialAuthSnapshot | null;
}

export interface HomeBootstrapSnapshot {
  modelSelector: ModelSelectorResponse;
}

export interface BootstrapRequestContext {
  origin: string;
  authorization?: string | null;
  authTimeoutMs?: number;
  cookie: string | null;
  fetchImpl: typeof fetch;
}

type BootstrapPath = '/api/auth/session' | '/api/v1/auth/me' | '/api/v1/models';

const withTimeout = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Web shell bootstrap request timed out'));
      }, timeoutMs);
    });
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const fetchBootstrapJson = async (
  context: BootstrapRequestContext,
  path: BootstrapPath,
  signal: AbortSignal
): Promise<unknown> => {
  const headers = new Headers({ accept: 'application/json' });
  if (context.authorization) {
    headers.set('authorization', context.authorization);
  }
  if (context.cookie) {
    headers.set('cookie', context.cookie);
  }

  const response = await context.fetchImpl(new URL(path, context.origin), {
    cache: 'no-store',
    headers,
    signal,
  });
  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
};

const fetchCurrentUserBootstrap = async (
  context: BootstrapRequestContext
): Promise<AuthenticatedUser | null> => {
  try {
    return await withTimeout(async (signal) => {
      const payload = await fetchBootstrapJson(context, '/api/v1/auth/me', signal);
      const parsed = authenticatedUserSchema.safeParse(payload);
      return parsed.success ? buildUserState(parsed.data) : null;
    }, context.authTimeoutMs ?? BOOTSTRAP_REQUEST_TIMEOUT_MS);
  } catch {
    return null;
  }
};

const fetchSessionUserBootstrap = async (
  context: BootstrapRequestContext
): Promise<AuthenticatedUser | null> => {
  try {
    return await withTimeout(async (signal) => {
      const payload = await fetchBootstrapJson(context, '/api/auth/session', signal);
      const parsed = sessionBootstrapSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.user) {
        return null;
      }

      return buildUserState({
        email: parsed.data.user.email,
        full_name: parsed.data.user.name ?? null,
        image: parsed.data.user.image ?? null,
      });
    }, context.authTimeoutMs ?? BOOTSTRAP_REQUEST_TIMEOUT_MS);
  } catch {
    return null;
  }
};

const loadAuthBootstrap = async (
  context: BootstrapRequestContext
): Promise<InitialAuthSnapshot | null> => {
  if (!context.cookie && !context.authorization) {
    return {
      user: null,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    };
  }

  const [profileUser, sessionUser] = await Promise.all([
    fetchCurrentUserBootstrap(context),
    fetchSessionUserBootstrap(context),
  ]);
  const user = profileUser ?? sessionUser;

  if (!user) {
    return {
      user: null,
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
    };
  }

  return {
    user,
    isAuthenticated: true,
    sessionStatus: 'authenticated',
  };
};

const loadModelSelectorBootstrap = async (
  context: BootstrapRequestContext
): Promise<ModelSelectorResponse> => {
  if (!context.cookie && !context.authorization) {
    return PUBLIC_MODEL_SELECTOR_CATALOG;
  }

  try {
    return await withTimeout(async (signal) => {
      const payload = await fetchBootstrapJson(context, '/api/v1/models', signal);
      const parsed = modelSelectorResponseSchema.safeParse(payload);
      return parsed.success ? parsed.data : PUBLIC_MODEL_SELECTOR_CATALOG;
    }, BOOTSTRAP_REQUEST_TIMEOUT_MS);
  } catch {
    return PUBLIC_MODEL_SELECTOR_CATALOG;
  }
};

export const loadRootBootstrapSnapshot = async (
  context: BootstrapRequestContext
): Promise<RootBootstrapSnapshot> => ({
  auth: await loadAuthBootstrap(context),
});

export const loadHomeBootstrapSnapshot = async (
  context: BootstrapRequestContext
): Promise<HomeBootstrapSnapshot> => ({
  modelSelector: await loadModelSelectorBootstrap(context),
});
