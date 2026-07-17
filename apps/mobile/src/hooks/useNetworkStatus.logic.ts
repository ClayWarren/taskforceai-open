export interface NetworkReachabilityState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export const isNetworkStateOnline = (state: NetworkReachabilityState): boolean =>
  state.isConnected === true && state.isInternetReachable !== false;
