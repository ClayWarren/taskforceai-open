import { useEffect, useState } from 'react';

import { logger } from '@taskforceai/web/app/lib/logger';
import { getDesktopAppServerStatus, type AppServerPetState } from '../platform/app-server';

export function useDesktopCompanionPet(desktopRuntime: boolean) {
  const [desktopPet, setDesktopPet] = useState<AppServerPetState | null>(null);

  useEffect(() => {
    if (!desktopRuntime) {
      setDesktopPet(null);
      return;
    }

    let active = true;
    const loadPet = async () => {
      try {
        const status = await getDesktopAppServerStatus();
        if (active) setDesktopPet(status.pet ?? null);
      } catch (error) {
        logger.debug('[App] Desktop companion unavailable', { error });
      }
    };

    void loadPet();
    const timer = window.setInterval(() => void loadPet(), 30_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [desktopRuntime]);

  return desktopPet;
}
