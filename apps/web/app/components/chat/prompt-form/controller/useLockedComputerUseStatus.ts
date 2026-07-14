import { useEffect, useState } from 'react';

import { logger } from '../../../../lib/logger';
import { invokeTauri } from '../../../../lib/platform/desktop-api';

export type LockedComputerUseStatus = {
  supported: boolean;
  installed: boolean;
  enabled: boolean;
  requiresInstall: boolean;
  installPath: string | null;
  packaged: boolean;
  packagePath: string | null;
  message: string;
};

const parseLockedComputerUseStatus = (value: unknown): LockedComputerUseStatus => {
  const record = value as Partial<LockedComputerUseStatus> | null;
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid locked computer use status');
  }
  return {
    supported: Boolean(record.supported),
    installed: Boolean(record.installed),
    enabled: Boolean(record.enabled),
    requiresInstall: Boolean(record.requiresInstall),
    installPath: typeof record.installPath === 'string' ? record.installPath : null,
    packaged: Boolean(record.packaged),
    packagePath: typeof record.packagePath === 'string' ? record.packagePath : null,
    message: typeof record.message === 'string' ? record.message : '',
  };
};

interface LockedComputerUseStatusOptions {
  platformRuntime: string;
  setErrorMessage: (_message: string) => void;
}

export function useLockedComputerUseStatus({
  platformRuntime,
  setErrorMessage,
}: LockedComputerUseStatusOptions) {
  const [status, setStatus] = useState<LockedComputerUseStatus | null>(null);

  useEffect(() => {
    if (platformRuntime !== 'desktop') {
      setStatus(null);
      return;
    }

    let cancelled = false;
    void invokeTauri('locked_computer_use_status', undefined, parseLockedComputerUseStatus)
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
        }
      })
      .catch((error: unknown) => {
        logger.error('Failed to load locked computer use status', { error });
      });

    return () => {
      cancelled = true;
    };
  }, [platformRuntime]);

  const toggleLockedComputerUse = () => {
    if (!status) {
      return;
    }
    const nextEnabled = !status.enabled;
    const command = status.requiresInstall
      ? 'install_locked_computer_use'
      : 'set_locked_computer_use_enabled';
    const args = status.requiresInstall ? undefined : { enabled: nextEnabled };
    void invokeTauri(command, args, parseLockedComputerUseStatus)
      .then((nextStatus) => {
        setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        logger.error('Failed to update locked computer use', { error });
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
  };

  return {
    lockedComputerUseStatus: status,
    toggleLockedComputerUse,
  };
}
