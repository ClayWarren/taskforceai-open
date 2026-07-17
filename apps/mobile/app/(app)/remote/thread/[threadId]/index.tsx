import { useLocalSearchParams, useRouter } from 'expo-router';

import { RemoteRouteScreen } from '../../../../../src/features/desktop-work/RemoteRouteScreen';

export default function RemoteThreadRoute() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <RemoteRouteScreen view="thread" threadId={threadId} onClose={() => router.back()} />;
}
