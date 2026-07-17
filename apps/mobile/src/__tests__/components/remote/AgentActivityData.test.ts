import {
  remoteAgentActivityDeepLink,
  remoteAgentActivityProps,
} from "../../../features/desktop-work/agent-activity";
import type {
  DesktopInteractionRequest,
  DesktopThread,
} from "../../../features/desktop-work/data/desktop-work";

const thread = (overrides: Partial<DesktopThread>): DesktopThread =>
  ({
    id: "thread-1",
    sessionId: "thread-1",
    hostId: "host/one",
    machineName: "Studio Mac",
    title: "Ship release",
    state: "active",
    archived: false,
    activeRunId: "run-1",
    updatedAt: 1,
    lastError: null,
    projectId: null,
    ...overrides,
  }) as DesktopThread;

describe("Remote agent activity data", () => {
  it("prioritizes attention and preserves the host needed by the deep link", () => {
    const interactions = [
      { threadId: "thread-attention" } as DesktopInteractionRequest,
    ];
    const props = remoteAgentActivityProps(
      [
        thread({ id: "thread-running", updatedAt: 20 }),
        thread({ id: "thread-attention", activeRunId: null, updatedAt: 10 }),
        thread({ id: "thread-done", activeRunId: null, state: "completed" }),
        thread({ id: "thread-archived", archived: true }),
      ],
      interactions,
      "Studio Mac",
    );

    expect(props.rows.map((row) => row.threadId)).toEqual([
      "thread-attention",
      "thread-running",
    ]);
    expect(props.rows[0]).toMatchObject({
      hostId: "host/one",
      status: "attention",
      detail: "Needs input",
    });
    expect(props.activeCount).toBe(2);
    expect(props.attentionCount).toBe(1);
  });

  it("orders equal-priority rows and labels failed and idle activity", () => {
    const props = remoteAgentActivityProps(
      [
        thread({ id: "thread-older", updatedAt: 10 }),
        thread({ id: "thread-failed", lastError: "boom", updatedAt: 30 }),
        thread({
          id: "thread-idle",
          activeRunId: null,
          updatedAt: 20,
        }),
      ],
      [],
      "Studio Mac",
    );

    expect(props.rows).toEqual([
      expect.objectContaining({
        threadId: "thread-failed",
        status: "failed",
        detail: "Failed",
      }),
      expect.objectContaining({
        threadId: "thread-idle",
        status: "completed",
        detail: "Done",
      }),
      expect.objectContaining({
        threadId: "thread-older",
        status: "running",
        detail: "Working",
      }),
    ]);
  });

  it("opens the host-aware Remote route used by quick actions", () => {
    expect(
      remoteAgentActivityDeepLink(
        remoteAgentActivityProps(
          [thread({ id: "thread ?1" })],
          [],
          "Studio Mac",
        ).rows[0]!,
      ),
    ).toBe(
      "taskforceai://remote/open?hostId=host%2Fone&threadId=thread%20%3F1",
    );
  });
});
