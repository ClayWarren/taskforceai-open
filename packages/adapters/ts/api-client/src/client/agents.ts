import { z } from 'zod';

import {
  agentInputSchema,
  agentSchema,
  type Agent,
  type AgentInput,
} from '@taskforceai/contracts/contracts';
import { createHelpers, type RequestContext } from './helpers';

export type { Agent, AgentInput };

export const createAgentsClient = (context: RequestContext) => {
  const { get, post } = createHelpers(context);

  return {
    listAgents: (): Promise<Agent[]> => get('/api/v1/agents', z.array(agentSchema)),
    upsertAgent: (input: AgentInput): Promise<Agent> =>
      post('/api/v1/agents', agentInputSchema.parse(input), agentSchema),
  };
};
