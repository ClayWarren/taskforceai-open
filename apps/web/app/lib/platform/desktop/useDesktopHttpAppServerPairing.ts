'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getDesktopAppServerHttpPairingInfo } from './app-server';
import {
  pairDesktopHttpAppServer,
  pingDesktopHttpAppServer,
  type DesktopHttpAppServerSession,
} from './http-app-server';

export type DesktopHttpPairingStatus = 'idle' | 'pairing' | 'connected' | 'error';

export type DesktopHttpPairingState = {
  status: DesktopHttpPairingStatus;
  session: DesktopHttpAppServerSession | null;
  error: string | null;
  connect: () => Promise<void>;
};

export const useDesktopHttpAppServerPairing = (): DesktopHttpPairingState => {
  const [status, setStatus] = useState<DesktopHttpPairingStatus>('idle');
  const [session, setSession] = useState<DesktopHttpAppServerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const connect = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus('pairing');
    setError(null);
    try {
      const info = await getDesktopAppServerHttpPairingInfo();
      const nextSession = await pairDesktopHttpAppServer(info);
      await pingDesktopHttpAppServer(nextSession);
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSession(nextSession);
      setStatus('connected');
    } catch (caught) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSession(null);
      setError(caught instanceof Error ? caught.message : 'Local pairing failed.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  return {
    status,
    session,
    error,
    connect,
  };
};
