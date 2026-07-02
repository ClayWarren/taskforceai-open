import { createFileRoute } from '@tanstack/react-router';

import DeviceLoginPage from '../../(auth)/login/device/page';

/**
 * Device login route (/login/device)
 * Used for CLI/TUI and desktop login flows.
 */
export const Route = createFileRoute('/login/device')({
  errorComponent: ({ reset }) => (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Something went wrong</h1>
      <button onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
        Retry
      </button>
    </div>
  ),
  component: DeviceLoginPage,
});
