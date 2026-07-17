import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityComponent,
  type LiveActivityLayout,
} from "expo-widgets";
import {
  remoteAgentActivityDeepLink,
  type AgentActivityProps,
  type AgentActivityRow,
} from "../features/desktop-work/agent-activity";

export type {
  AgentActivityProps,
  AgentActivityRow,
} from "../features/desktop-work/agent-activity";

type AgentActivityEnvironment = Parameters<
  LiveActivityComponent<AgentActivityProps>
>[1];

export function AgentActivity(
  props: AgentActivityProps,
  environment: AgentActivityEnvironment,
): LiveActivityLayout {
  "widget";

  const primary = "primary";
  const secondary = "secondary";
  const tint = environment.isLuminanceReduced
    ? secondary
    : props.attentionCount > 0
      ? "#fbbf24"
      : "#818cf8";
  const rowColor = (status: AgentActivityRow["status"]): string => {
    if (environment.isLuminanceReduced) return secondary;
    if (status === "attention") return "#fbbf24";
    if (status === "failed") return "#fca5a5";
    if (status === "completed") return "#6ee7b7";
    return "#a5b4fc";
  };
  const symbol = (
    status: AgentActivityRow["status"],
  ):
    | "bolt.fill"
    | "exclamationmark.circle.fill"
    | "checkmark.circle.fill"
    | "xmark.octagon.fill" => {
    if (status === "attention") return "exclamationmark.circle.fill";
    if (status === "failed") return "xmark.octagon.fill";
    if (status === "completed") return "checkmark.circle.fill";
    return "bolt.fill";
  };
  const row0 = props.rows[0];
  const row1 = props.rows[1];
  const row2 = props.rows[2];
  const deepLink = row0 ? remoteAgentActivityDeepLink(row0) : null;
  const renderRow = (row: AgentActivityRow) => (
    <HStack spacing={7} alignment="center">
      <Image systemName={symbol(row.status)} />
      <Text
        modifiers={[
          font({ weight: "semibold", size: 12 }),
          foregroundStyle(primary),
          lineLimit(1),
        ]}
      >
        {row.title}
      </Text>
      <Spacer minLength={6} />
      <Text
        modifiers={[
          font({ size: 11 }),
          foregroundStyle(rowColor(row.status)),
          lineLimit(1),
        ]}
      >
        {row.detail}
      </Text>
    </HStack>
  );

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={7}
        modifiers={
          deepLink
            ? [padding({ all: 14 }), widgetURL(deepLink)]
            : [padding({ all: 14 })]
        }
      >
        <HStack spacing={6} alignment="center">
          <Image systemName="bolt.horizontal.circle.fill" />
          <Text
            modifiers={[
              font({ weight: "bold", size: 13 }),
              foregroundStyle(tint),
              lineLimit(1),
            ]}
          >
            {props.attentionCount > 0
              ? `${props.attentionCount} need attention`
              : `${props.activeCount} active on ${props.machineName}`}
          </Text>
          <Spacer minLength={0} />
        </HStack>
        {row0 ? renderRow(row0) : null}
        {row1 ? renderRow(row1) : null}
        {row2 ? renderRow(row2) : null}
      </VStack>
    ),
    compactLeading: (
      <Image
        systemName={
          props.attentionCount > 0 ? "exclamationmark.circle.fill" : "bolt.fill"
        }
      />
    ),
    compactTrailing: (
      <Text
        modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(tint)]}
      >
        {props.attentionCount > 0 ? props.attentionCount : props.activeCount}
      </Text>
    ),
    minimal: (
      <Image
        systemName={
          props.attentionCount > 0 ? "exclamationmark.circle.fill" : "bolt.fill"
        }
      />
    ),
    expandedLeading: <Image systemName="bolt.horizontal.circle.fill" />,
    expandedTrailing: (
      <Text
        modifiers={[font({ weight: "bold", size: 12 }), foregroundStyle(tint)]}
      >
        {props.activeCount}
      </Text>
    ),
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={
          deepLink
            ? [padding({ all: 8 }), widgetURL(deepLink)]
            : [padding({ all: 8 })]
        }
      >
        {row0 ? renderRow(row0) : null}
        {row1 ? renderRow(row1) : null}
        {row2 ? renderRow(row2) : null}
      </VStack>
    ),
  };
}

export default createLiveActivity<AgentActivityProps>(
  "AgentActivity",
  AgentActivity,
);
