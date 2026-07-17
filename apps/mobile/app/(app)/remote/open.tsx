import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useSelectDesktopHostMutation } from '../../../src/features/desktop-work/data/desktop-work';

export default function RemoteQuickActionRoute() {
  const router = useRouter();
  const { hostId, threadId } = useLocalSearchParams<{ hostId?: string; threadId?: string }>();
  const selectHost = useSelectDesktopHostMutation();

  React.useEffect(() => {
    if (!threadId) {
      router.replace('/remote' as Href);
      return;
    }
    const open = () => router.replace({
      pathname: '/remote/thread/[threadId]',
      params: { threadId },
    } as unknown as Href);
    if (hostId) selectHost.mutate(hostId, { onSuccess: open, onError: () => router.replace('/remote' as Href) });
    else open();
  }, [hostId, router, selectHost, threadId]);

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
}
