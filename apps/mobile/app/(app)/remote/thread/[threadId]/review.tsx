import { useLocalSearchParams, useRouter } from 'expo-router';

import { RemoteRouteScreen } from '../../../../../src/features/desktop-work/RemoteRouteScreen';

export default function RemoteReviewRoute() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <RemoteRouteScreen view="review" threadId={threadId} onClose={() => router.back()} />;
}
