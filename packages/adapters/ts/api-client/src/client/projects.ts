import { z } from 'zod';

import {
  type CreateProjectRequest,
  type Project,
  projectSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, positiveIntegerPathSegment, type RequestContext } from './helpers';

export const createProjectsClient = (context: RequestContext) => {
  const { get, post, request } = createHelpers(context);

  return {
    getProjects: (): Promise<Project[]> => get('/api/v1/projects', z.array(projectSchema)),
    createProject: (d: CreateProjectRequest): Promise<Project> =>
      post('/api/v1/projects', d, projectSchema),
    deleteProject: (id: number) =>
      request(
        `/api/v1/projects/${positiveIntegerPathSegment(id, 'Project ID')}`,
        { method: 'DELETE' },
        { parseJson: false }
      ),
  };
};
