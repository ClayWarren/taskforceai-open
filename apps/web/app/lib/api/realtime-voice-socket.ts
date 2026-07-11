import { getGatewayRealtimeProtocols } from '@taskforceai/client-runtime';

export const openRealtimeVoiceSocket = (url: string, token: string): WebSocket =>
  new WebSocket(url, getGatewayRealtimeProtocols(token));
