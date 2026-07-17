import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getMobileClient } from "../../api/client";
import { mobileEnv } from "../../config/env";
import { mobileLogger } from "../../logger";
import { remoteAgentActivityProps } from "./agent-activity";
import type {
  DesktopInteractionRequest,
  DesktopThread,
} from "./data/desktop-work";

const LIVE_ACTIVITY_TOKEN_KEY = "@taskforceai:agent-activity-push-token";

export const syncRemoteAgentLiveActivity = async (
  threads: DesktopThread[],
  interactions: DesktopInteractionRequest[],
  machineName: string,
): Promise<void> => {
  if (Platform.OS !== "ios" || mobileEnv.nodeEnv === "test") return;
  const props = remoteAgentActivityProps(threads, interactions, machineName);
  try {
    const { default: AgentActivity } =
      await import("../../widgets/AgentActivity");
    const instances = AgentActivity.getInstances();
    if (props.rows.length === 0) {
      await Promise.all(
        instances.map((instance) => instance.end("default", props)),
      );
      return;
    }
    const activeInstances =
      instances.length === 0
        ? [AgentActivity.start(props, "taskforceai://remote")]
        : instances;
    if (instances.length > 0)
      await Promise.all(
        activeInstances.map((instance) => instance.update(props)),
      );
    await Promise.all(activeInstances.map(registerLiveActivityPushToken));
  } catch (error) {
    mobileLogger.warn(
      "[RemoteLiveActivity] Failed to synchronize agent activity",
      { error },
    );
  }
};

const registerLiveActivityPushToken = async (instance: {
  getPushToken: () => Promise<string | null>;
}): Promise<void> => {
  const token = await instance.getPushToken();
  if (!token || token === (await AsyncStorage.getItem(LIVE_ACTIVITY_TOKEN_KEY)))
    return;
  await getMobileClient().registerPushToken({
    token,
    platform: "ios-live-activity",
    deviceId: "AgentActivity",
    appVersion: Constants.expoConfig?.version ?? "",
  });
  await AsyncStorage.setItem(LIVE_ACTIVITY_TOKEN_KEY, token);
};
