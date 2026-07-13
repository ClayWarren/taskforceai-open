import { createFileRoute } from '@tanstack/react-router';

import DeviceLoginPage from '../../(auth)/login/device/page';
import { RouteError } from '../-route-error';

/**
 * Device login route (/login/device)
 * Used for CLI/TUI and desktop login flows.
 */
export const Route = createFileRoute('/login/device')({
  errorComponent: RouteError,
  component: DeviceLoginPage,
});
