import { it, expect } from "@effect/vitest";
import {
  CommandId,
  ContextTransferId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderTurnId,
  ProviderThreadId,
  RunId,
  RunAttemptId,
  ThreadId,
  NodeId,
  ProviderDriverKind,
  UsageReadError,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2RunAttempt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Execution from "./ExecutionRequestService.ts";
import * as Threads from "./ThreadManagementService.ts";
import * as Launch from "./ThreadLaunchService.ts";
import * as Receipts from "./CommandReceiptStore.ts";
import * as Events from "./EventStore.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as Usage from "../usage/UsageService.ts";
import { priceRunUsage } from "../usage/runUsage.ts";
import { parseRateTable } from "../usage/usagePricing.ts";
import { v2PullRequestThread } from "./testkit/pullRequestFixtures.ts";
import type { ProjectionRecordField, ProjectionRecords } from "./ProjectionStore.ts";

it.effect(
  "execution costs isolate exact runs, include attributable children once, and keep status available on missing pricing",
  () =>
    Effect.gen(function* () {
      const requestId = "request";
      const threadId = ThreadId.make(`mation-${requestId}`);
      const projectId = ProjectId.make("project");
      const now = yield* DateTime.now;
      const iso = DateTime.formatIso(now);
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
      const shell = {
        ...v2PullRequestThread({
          id: threadId,
          projectId,
          title: "Investigation",
          modelSelection,
          runtimeMode: "auto",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          pullRequests: [],
          latestUserMessageAt: null,
          createdAt: iso,
          updatedAt: iso,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
        }),
        automationOrigin: "external" as const,
      };
      const runId = RunId.make("completed-investigation");
      const messageId = MessageId.make(`mation-message:${requestId}`);
      const records: ProjectionRecords<ProjectionRecordField> = {
        attempts: [],
        nodes: [],
        subagents: [],
        providerSessions: [],
        providerThreads: [],
        providerTurns: [],
        runtimeRequests: [],
        plans: [],
        turnItems: [],
        checkpointScopes: [],
        checkpoints: [],
        contextHandoffs: [],
        contextTransfers: [],
        thread: { ...shell, lastVisitedAt: null },
        runs: [
          {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: messageId,
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed" as const,
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          },
        ],
        messages: [
          {
            id: messageId,
            threadId,
            runId,
            nodeId: null,
            role: "user" as const,
            text: "Read the Sentry alert",
            attachments: [],
            streaming: false,
            createdBy: "system" as const,
            creationSource: "server" as const,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      const makeAttempt = (id: string, runId: RunId): OrchestrationV2RunAttempt => ({
        id: RunAttemptId.make(id),
        runId,
        attemptOrdinal: 1,
        rootNodeId: NodeId.make(id),
        providerInstanceId: modelSelection.instanceId,
        providerThreadId: ProviderThreadId.make(id),
        providerTurnId: ProviderTurnId.make(id),
        reason: "initial",
        status: "completed",
        startedAt: now,
        completedAt: now,
      });
      const makeTurn = (id: string, inputTokens: number): OrchestrationV2ProviderTurn => ({
        id: ProviderTurnId.make(id),
        providerThreadId: ProviderThreadId.make(id),
        nodeId: NodeId.make(id),
        runAttemptId: RunAttemptId.make(id),
        nativeTurnRef: null,
        ordinal: 1,
        status: "completed",
        startedAt: now,
        completedAt: now,
        turnTokenUsage: {
          usageScope: "main_agent",
          usageStatus: "complete",
          inputTokens,
          outputTokens: 0,
          hasSubagents: false,
        },
      });
      const otherId = RunId.make("unrelated-run");
      const childId = ThreadId.make("child-thread");
      const taskId = NodeId.make("attributable-child");
      const childRun = {
        ...records.runs[0]!,
        id: RunId.make("child-run"),
        threadId: childId,
      };
      let child: ProjectionRecords<ProjectionRecordField> = {
        ...records,
        thread: {
          ...records.thread,
          id: childId,
          lineage: {
            rootThreadId: threadId,
            parentThreadId: threadId,
            relationshipToParent: "subagent",
          },
          forkedFrom: { type: "node", nodeId: taskId },
        },
        contextTransfers: [
          {
            id: ContextTransferId.make("spawn"),
            type: "subagent_spawn",
            sourceThreadId: threadId,
            targetThreadId: childId,
            sourcePoint: { threadId, runId },
            basePoint: null,
            sourceProviderInstanceId: modelSelection.instanceId,
            targetProviderInstanceId: modelSelection.instanceId,
            targetRunId: childRun.id,
            status: "consumed",
            resolution: null,
            createdBy: "agent",
            error: null,
            createdAt: now,
            updatedAt: now,
            consumedAt: now,
          },
        ],
        runs: [childRun, { ...childRun, id: otherId, delegatedTaskId: NodeId.make("other-task") }],
        attempts: [makeAttempt("child", childRun.id), makeAttempt("unrelated-child", otherId)],
        providerTurns: [makeTurn("child", 200), makeTurn("unrelated-child", 100_000)],
      };
      let parent: ProjectionRecords<ProjectionRecordField> = {
        ...records,
        runs: [...records.runs, { ...records.runs[0]!, id: otherId, ordinal: 2 }],
        attempts: [
          makeAttempt("parent", runId),
          makeAttempt("retry", runId),
          makeAttempt("unrelated", otherId),
        ],
        providerTurns: [
          makeTurn("parent", 100),
          makeTurn("retry", 50),
          makeTurn("unrelated", 100_000),
        ],
        subagents: [
          {
            id: taskId,
            threadId,
            runId,
            parentNodeId: NodeId.make("parent"),
            origin: "app_owned",
            createdBy: "agent",
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: modelSelection.instanceId,
            providerThreadId: null,
            childThreadId: childId,
            nativeTaskRef: null,
            prompt: "Read",
            title: null,
            model: "test",
            status: "completed",
            result: "Done",
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        ],
      };
      const nativeId = ThreadId.make("native-child");
      const nativeTask = {
        ...parent.subagents[0]!,
        id: NodeId.make("native-task"),
        origin: "provider_native" as const,
        childThreadId: nativeId,
        providerThreadId: ProviderThreadId.make("native-provider"),
      };
      const native: ProjectionRecords<ProjectionRecordField> = {
        ...records,
        runs: [],
        thread: {
          ...records.thread,
          id: nativeId,
          lineage: {
            rootThreadId: threadId,
            parentThreadId: threadId,
            relationshipToParent: "subagent",
          },
          forkedFrom: { type: "node", nodeId: nativeTask.id },
        },
        providerThreads: [
          {
            id: nativeTask.providerThreadId!,
            driver: nativeTask.driver,
            providerInstanceId: nativeTask.providerInstanceId,
            providerSessionId: null,
            appThreadId: nativeId,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: {
              providerThreadId: ProviderThreadId.make("parent"),
              providerTurnId: ProviderTurnId.make("parent"),
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        providerTurns: [
          {
            ...makeTurn("native", 125),
            providerThreadId: nativeTask.providerThreadId!,
            runAttemptId: null,
          },
          makeTurn("unrelated-native", 100_000),
          {
            ...makeTurn("later-native", 100_000),
            providerThreadId: nativeTask.providerThreadId!,
            runAttemptId: null,
            startedAt: DateTime.add(now, { hours: 1 }),
            completedAt: DateTime.add(now, { hours: 1 }),
          },
        ],
      };
      let failPricing = false;
      let costReads = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
          getProjectThreadRecords: () => Effect.succeed(parent),
          getThreadRecords: (id) =>
            Effect.succeed(id === nativeId ? native : id === childId ? child : parent),
        }),
        Layer.mock(Launch.ThreadLaunchService)({}),
        Layer.mock(Events.EventStoreV2)({}),
        Layer.mock(Receipts.CommandReceiptStoreV2)({
          getByCommandId: () => Effect.succeedNone,
        }),
        Layer.mock(Projects.ProjectService)({}),
        Layer.mock(Providers.ProviderRegistry)({}),
        Layer.mock(Environment.ServerEnvironmentIdentity)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
        }),
        Layer.mock(Usage.UsageService)({
          readRunCost: (input) =>
            Effect.suspend(() => {
              costReads++;
              return failPricing
                ? Effect.fail(new UsageReadError({ reason: "scanFailed", detail: "Unavailable" }))
                : Effect.succeed(
                    priceRunUsage(
                      input,
                      parseRateTable({
                        test: { input_cost_per_token: 0.01, output_cost_per_token: 0.01 },
                      }),
                      new Map(),
                      new Map(),
                    ),
                  );
            }),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* Execution.ExecutionRequestService;
        const query = { projectId, threadId, messageId };
        const first = yield* service.get(CommandId.make("request"), query);
        expect(first.cost).toEqual({ usd: 3.5, coverage: "complete" });
        expect((yield* service.get(CommandId.make("request"), query)).cost).toEqual(first.cost);
        expect(costReads).toBe(2);
        yield* service
          .get(CommandId.make("request"), { ...query, projectId: ProjectId.make("wrong-project") })
          .pipe(
            Effect.match({
              onSuccess: () => {
                throw new Error("Wrong project accepted");
              },
              onFailure: (error) => expect(error._tag).toBe("ExecutionNotFoundError"),
            }),
          );
        expect(costReads).toBe(2);
        const followupTaskId = NodeId.make("followup-task");
        const followupRun = {
          ...childRun,
          id: RunId.make("followup-run"),
          delegatedTaskId: followupTaskId,
        };
        child = {
          ...child,
          runs: [...child.runs, followupRun],
          attempts: [...child.attempts, makeAttempt("followup", followupRun.id)],
          providerTurns: [...child.providerTurns, makeTurn("followup", 75), makeTurn("child", 200)],
        };
        parent = {
          ...parent,
          subagents: [
            ...parent.subagents,
            { ...parent.subagents[0]!, id: followupTaskId },
            nativeTask,
          ],
        };
        expect((yield* service.get(CommandId.make("request"), query)).cost).toEqual({
          usd: 5.5,
          coverage: "complete",
        });
        parent = { ...parent, subagents: [...parent.subagents].reverse() };
        expect((yield* service.get(CommandId.make("request"), query)).cost).toEqual({
          usd: 5.5,
          coverage: "complete",
        });
        const known = parent.subagents;
        parent = {
          ...parent,
          subagents: [
            ...known,
            { ...known[0]!, id: taskId, origin: "app_owned", childThreadId: threadId },
          ],
        };
        expect((yield* service.get(CommandId.make("request"), query)).cost).toEqual({
          usd: 5.5,
          coverage: "partial",
        });
        parent = { ...parent, subagents: known };
        failPricing = true;
        const failed = yield* service.get(CommandId.make("request"), query);
        expect(failed.status).toBe("completed");
        expect(failed.ref.runId).toBe(runId);
        expect(failed.cost).toEqual({ usd: null, coverage: "unavailable" });
      }).pipe(Effect.provide(Execution.layer.pipe(Layer.provide(dependencies))));
    }),
);
