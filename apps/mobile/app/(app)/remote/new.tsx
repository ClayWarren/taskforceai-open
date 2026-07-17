import { useLocalSearchParams, useRouter } from 'expo-router';

import { RemoteRouteScreen } from '../../../src/features/desktop-work/RemoteRouteScreen';

export default function RemoteNewRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskMode?: string; projectId?: string; hostId?: string }>();
  return (
    <RemoteRouteScreen
      view="new"
      preset={{
        taskMode: params.taskMode === 'code' ? 'code' : 'chat',
        projectId: params.projectId ? Number(params.projectId) : null,
        hostId: params.hostId ?? null,
      }}
      onClose={() => router.back()}
    />
  );
}
