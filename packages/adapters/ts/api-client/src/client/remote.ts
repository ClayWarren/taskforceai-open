import { z } from 'zod';

import { createHelpers, encodePathSegment, type RequestContext } from './helpers';

const remoteTargetSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  allowConnections: z.boolean(),
  keepAwake: z.boolean(),
  lastSeenAt: z.string(),
});

const remoteConnectionsSchema = z.object({ devices: z.array(remoteTargetSchema) });
const remotePairSchema = remoteTargetSchema;
const remoteCommandSchema = z.object({ commandId: z.string().min(1) });
const remoteResultSchema = z.object({
  status: z.enum(['pending', 'complete']),
  response: z.unknown().optional(),
});

export type RemoteTarget = z.infer<typeof remoteTargetSchema>;
export type RemoteResult = z.infer<typeof remoteResultSchema>;

export const createRemoteClient = (context: RequestContext) => {
  const { request, buildJsonHeaders } = createHelpers(context);
  const deviceHeaders = (deviceId: string, deviceCredential: string) =>
    buildJsonHeaders({
      'X-Device-Id': deviceId,
      'X-Device-Credential': deviceCredential,
    });

  return {
    listRemoteConnections: async (input: {
      deviceId: string;
      deviceCredential: string;
    }): Promise<RemoteTarget[]> => {
      const body = await request('/api/v1/remote/connections', {
        method: 'GET',
        headers: deviceHeaders(input.deviceId, input.deviceCredential),
      });
      return remoteConnectionsSchema.parse(body).devices;
    },
    pairRemoteDevice: async (input: {
      deviceId: string;
      deviceCredential: string;
      deviceName: string;
      code: string;
    }): Promise<RemoteTarget> =>
      remotePairSchema.parse(
        await request('/api/v1/remote/pair', {
          method: 'POST',
          headers: deviceHeaders(input.deviceId, input.deviceCredential),
          body: JSON.stringify({ code: input.code, deviceName: input.deviceName }),
        })
      ),
    enqueueRemoteRpc: async (input: {
      controllerDeviceId: string;
      deviceCredential: string;
      targetDeviceId: string;
      request: unknown;
    }): Promise<string> => {
      const body = await request(
        `/api/v1/remote/devices/${encodePathSegment(input.targetDeviceId)}/rpc`,
        {
          method: 'POST',
          headers: deviceHeaders(input.controllerDeviceId, input.deviceCredential),
          body: JSON.stringify({ request: input.request }),
        }
      );
      return remoteCommandSchema.parse(body).commandId;
    },
    getRemoteRpcResult: async (input: {
      controllerDeviceId: string;
      deviceCredential: string;
      targetDeviceId: string;
      commandId: string;
    }): Promise<RemoteResult> =>
      remoteResultSchema.parse(
        await request(
          `/api/v1/remote/devices/${encodePathSegment(input.targetDeviceId)}/commands/${encodePathSegment(input.commandId)}/result`,
          {
            method: 'GET',
            headers: deviceHeaders(input.controllerDeviceId, input.deviceCredential),
          }
        )
      ),
  };
};
