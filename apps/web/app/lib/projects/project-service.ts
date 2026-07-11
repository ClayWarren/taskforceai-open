import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import type { CreateProjectRequest, Project } from '@taskforceai/contracts/contracts';

import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { logger } from '../logger';
import { type Result, err, ok } from '@taskforceai/client-core/result';

export const fetchProjects = async (): Promise<Result<Project[]>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const data = await client.getProjects();
    return ok(data);
  } catch (error) {
    logger.error('Failed to fetch projects', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const createNewProject = async (data: CreateProjectRequest): Promise<Result<Project>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    const res = await client.createProject(data);
    return ok(res);
  } catch (error) {
    logger.error('Failed to create project', { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const deleteUserProject = async (id: number): Promise<Result<true>> => {
  try {
    const client = getBrowserClient({ getCsrfToken });
    await client.deleteProject(id);
    return ok(true);
  } catch (error) {
    logger.error('Failed to delete project', { error, projectId: id });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
