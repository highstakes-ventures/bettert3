import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { compactDynamicToolOutput, paiWidgetFromToolItem } from "@t3tools/shared/toolOutput";
import { deriveTimelineEntriesFromVisibleTurnItems } from "./session-logic";
import { deriveMessagesTimelineRows } from "./components/chat/MessagesTimeline.logic";

const reportId = "a".repeat(64);
const runId = RunId.make("morning-run");
const base = (id: string, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId: ThreadId.make("morning-thread"),
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: DateTime.makeUnsafe("2026-10-28T08:00:00Z"),
  completedAt: DateTime.makeUnsafe("2026-10-28T08:00:00Z"),
  updatedAt: DateTime.makeUnsafe("2026-10-28T08:00:00Z"),
});
const call = (
  id: string,
  ordinal: number,
): Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }> => ({
  ...base(id, ordinal),
  type: "dynamic_tool",
  toolName: "mcp__t3-code__pai_publish_email_items",
  input: {},
  output: {
    structuredContent: {
      published: 1,
      paiWidget: { reportId },
      privateEmail: "Must not travel in the compact timeline.",
    },
  },
});
const visible = (item: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem => ({
  position: item.ordinal,
  visibility: "local",
  sourceThreadId: item.threadId,
  sourceItemId: item.id,
  item,
});

describe("PAI widget publication", () => {
  it("keeps only the report reference and accepts a successful known publishing tool", () => {
    const item = call("publication", 1);
    expect(compactDynamicToolOutput(item.output)).toEqual({ paiWidget: { reportId } });
    expect(paiWidgetFromToolItem(item)).toEqual({ reportId });
    expect(paiWidgetFromToolItem({ ...item, toolName: "other_server.some_tool" })).toBeUndefined();
    expect(
      paiWidgetFromToolItem({ ...item, output: { isError: true, paiWidget: { reportId } } }),
    ).toBeUndefined();
  });

  it("renders one stable report after a publication replay and a same-run steer without an assistant reply", () => {
    const steer: OrchestrationV2TurnItem = {
      ...base("steer", 3),
      type: "user_message",
      messageId: MessageId.make("steer-message"),
      inputIntent: "steer",
      text: "Keep checking",
      createdBy: "user",
      creationSource: "server",
      attachments: [],
    };
    const entries = deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: [call("first", 1), call("replay", 2), steer].map(visible),
      optimisticMessages: [],
    });
    const widgets = entries.filter((entry) => entry.kind === "pai-widget");
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.id).toBe(`pai-widget:${reportId}`);
    const rows = deriveMessagesTimelineRows({
      timelineEntries: entries,
      latestRun: {
        runId,
        status: "completed",
        startedAt: "2026-10-28T08:00:00Z",
        completedAt: "2026-10-28T08:00:01Z",
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(rows.filter((row) => row.kind === "pai-widget")).toHaveLength(1);
  });

  it("never mounts an email widget for an unrelated run or an unsuccessful publication", () => {
    const failed = { ...call("failed", 1), status: "failed" as const };
    const unrelated = { ...call("other", 2), toolName: "some_other_tool" };
    const entries = deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: [failed, unrelated].map(visible),
      optimisticMessages: [],
    });
    expect(entries.some((entry) => entry.kind === "pai-widget")).toBe(false);
  });
});
