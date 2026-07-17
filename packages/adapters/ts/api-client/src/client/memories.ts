import {
  type CreateMemoryRequest,
  type Memory,
  type UpdateMemoryRequest,
  createMemoryRequestSchema,
  memorySchema,
  updateMemoryRequestSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, positiveIntegerPathSegment, type RequestContext } from './helpers';

export const createMemoriesClient = (context: RequestContext) => {
  const { get, request, buildJsonHeaders } = createHelpers(context);

  return {
    listMemories: (): Promise<Memory[]> => get('/api/v1/memories', memorySchema.array()),

    createMemory: async (body: CreateMemoryRequest): Promise<void> => {
      const parsedBody = createMemoryRequestSchema.parse(body);
      await request('/api/v1/memories', {
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify(parsedBody),
      });
    },

    updateMemory: async (id: number, body: UpdateMemoryRequest): Promise<Memory> => {
      const memoryId = positiveIntegerPathSegment(id, 'memory id');
      const parsedBody = updateMemoryRequestSchema.parse(body);
      return memorySchema.parse(
        await request(`/api/v1/memories/${memoryId}`, {
          method: 'PATCH',
          headers: buildJsonHeaders(),
          body: JSON.stringify(parsedBody),
        })
      );
    },

    deleteMemory: async (id: number): Promise<void> => {
      const memoryId = positiveIntegerPathSegment(id, 'memory id');
      await request(`/api/v1/memories/${memoryId}`, {
        method: 'DELETE',
      });
    },
  };
};
