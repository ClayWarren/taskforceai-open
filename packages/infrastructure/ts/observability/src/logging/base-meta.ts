/**
 * Base metadata attached to every structured log entry.
 *
 * Keep this small and stable so logs are searchable across apps and runtimes.
 */
export type BaseLogMeta = Readonly<{
  app: string;
  service: string;
  runtime?: string;
}>;

export const buildBaseLogMeta = (meta: BaseLogMeta): Record<string, unknown> => ({
  app: meta.app,
  service: meta.service,
  ...(meta.runtime ? { runtime: meta.runtime } : {}),
});
