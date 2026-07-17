import { useRouter } from 'expo-router';

import { RemoteRouteScreen } from '../../../src/features/desktop-work/RemoteRouteScreen';

export default function RemoteIndexRoute() {
  const router = useRouter();
  return <RemoteRouteScreen view="workspaces" onClose={() => router.back()} />;
}
