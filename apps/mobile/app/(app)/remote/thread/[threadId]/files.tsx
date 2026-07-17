import { useLocalSearchParams, useRouter } from 'expo-router';

import { RemoteRouteScreen } from '../../../../../src/features/desktop-work/RemoteRouteScreen';

export default function RemoteFilesRoute() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <RemoteRouteScreen view="files" threadId={threadId} onClose={() => router.back()} />;
}
