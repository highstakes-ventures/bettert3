import { it, expect } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  MationExecutionInput,
  MessageId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import { isAutomaticThread } from "@t3tools/shared/threadAttention";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";
import * as ExecutionRequests from "../orchestration-v2/ExecutionRequestService.ts";
import * as Events from "../orchestration-v2/EventStore.ts";
import * as Execution from "./AutomationExecutionService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Receipts from "../orchestration-v2/CommandReceiptStore.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as DateTime from "effect/DateTime";
import { v2PullRequestThread } from "../orchestration-v2/testkit/pullRequestFixtures.ts";
import type {
  ProjectionRecordField,
  ProjectionRecords,
} from "../orchestration-v2/ProjectionStore.ts";

const decodeExecutionInput = Schema.decodeEffect(MationExecutionInput);

it.effect(
  "user-started email actions launch in the normal roster while scheduled executions remain Automatic",
  () =>
    Effect.gen(function* () {
      let launched: Launch.ThreadLaunchInput | undefined;
      const dependencies = Layer.mergeAll(
        Layer.mock(Events.EventStoreV2)({}),
        Layer.mock(Threads.ThreadManagementService)({ getThreadShell: () => Effect.succeed(null) }),
        Layer.mock(Receipts.CommandReceiptStoreV2)({
          getByCommandId: () => Effect.succeed(Option.none()),
        }),
        Layer.mock(Launch.ThreadLaunchService)({
          launch: (input) => {
            launched = input;
            return Effect.die("Stop before provider execution; inspect the real launch request.");
          },
        }),
        Layer.mock(Projects.ProjectService)({}),
        Layer.mock(Providers.ProviderRegistry)({}),
        FileSystem.layerNoop({}),
        Layer.succeed(HostProcess.Environment, {}),
        Layer.mock(Environment.ServerEnvironmentIdentity)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
        }),
        FetchHttpClient.layer,
      );
      yield* Effect.gen(function* () {
        const service = yield* Execution.AutomationExecutionService;
        for (const foreground of [true, undefined]) {
          launched = undefined;
          const input = yield* decodeExecutionInput({
            title: "Investigate this email",
            prompt: "Read the Sentry alert",
            ...(foreground ? { foreground } : {}),
            target: {
              projectId: ProjectId.make("project"),
              threadId: null,
              workspaceStrategy: { type: "root" },
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
              runtimeMode: "auto",
              interactionMode: "default",
            },
          });
          yield* service.start("00000000-0000-4000-8000-000000000001", input).pipe(Effect.exit);
          const record = launched as Launch.ThreadLaunchInput | undefined;
          expect(record).toBeDefined();
          expect(isAutomaticThread(record!)).toBe(foreground !== true);
          expect(record!.createdBy).toBe(foreground ? "user" : "system");
          expect(record!.threadId).toBe("mation-00000000-0000-4000-8000-000000000001");
          expect(record!.initialMessage?.text).toBe("Read the Sentry alert");
        }
      }).pipe(
        Effect.provide(
          Execution.layer.pipe(
            Layer.provide(ExecutionRequests.layer.pipe(Layer.provide(dependencies))),
            Layer.provide(dependencies),
          ),
        ),
      );
    }),
);

it.effect(
  "completed-action retries reuse the same chat without sending, and mismatched prompts fail",
  () =>
    Effect.gen(function* () {
      const requestId = "00000000-0000-4000-8000-000000000001";
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
      const commands: OrchestrationV2ServerCommand[] = [];
      let launched = 0,
        sent = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(Events.EventStoreV2)({}),
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
          getProjectThreadRecords: <K extends ProjectionRecordField>(
            _query: unknown,
            fields: ReadonlyArray<K>,
          ) => {
            expect(fields).toEqual(["runs", "messages"]);
            return Effect.succeed(records);
          },
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: 1, storedEvents: [] };
            }),
          sendToThread: () => {
            sent++;
            return Effect.die("A retry must not send a message.");
          },
        }),
        Layer.mock(Launch.ThreadLaunchService)({
          launch: () => {
            launched++;
            return Effect.die("A retry must not launch a provider.");
          },
        }),
        Layer.mock(Receipts.CommandReceiptStoreV2)({
          getByCommandId: () => Effect.succeed(Option.none()),
        }),
        Layer.mock(Projects.ProjectService)({}),
        Layer.mock(Providers.ProviderRegistry)({}),
        FileSystem.layerNoop({}),
        Layer.succeed(HostProcess.Environment, {}),
        FetchHttpClient.layer,
        Layer.mock(Environment.ServerEnvironmentIdentity)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* Execution.AutomationExecutionService;
        const input = yield* decodeExecutionInput({
          foreground: true,
          title: "Investigation",
          prompt: records.messages[0]!.text,
          target: {
            projectId,
            threadId: null,
            workspaceStrategy: { type: "root" },
            modelSelection,
            runtimeMode: "auto",
            interactionMode: "default",
          },
        });
        const execution = {
          ref: { environmentId: "env", threadId, runId },
          status: "completed",
          startedAt: iso,
          completedAt: iso,
          worktreePath: null,
          branch: null,
        };
        expect(yield* service.start(requestId, input)).toEqual(execution);
        expect(yield* service.start(requestId, input)).toEqual(execution);
        expect(commands).toHaveLength(0);
        yield* service.start(requestId, { ...input, prompt: "A different instruction" }).pipe(
          Effect.match({
            onSuccess: () => {
              throw new Error("A mismatched prompt was accepted.");
            },
            onFailure: (error) => expect(error._tag).toBe("MationConflictError"),
          }),
        );
        expect(commands).toHaveLength(0);
        expect(launched).toBe(0);
        expect(sent).toBe(0);
        expect(records.runs).toHaveLength(1);
        expect(records.messages).toHaveLength(1);
      }).pipe(
        Effect.provide(
          Execution.layer.pipe(
            Layer.provide(ExecutionRequests.layer.pipe(Layer.provide(dependencies))),
            Layer.provide(dependencies),
          ),
        ),
      );
    }),
);

it.effect(
  "the app relay sends browser policy decisions to Mation with the verified T3 environment",
  () => {
    const forwarded: Array<{
      url: string;
      body: { environmentId: string; request: { path: string } };
    }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const body = (await request.json()) as { environmentId: string; request: { path: string } };
      forwarded.push({ url: request.url, body });
      return body.request.path === "email/reports"
        ? new Response('{"error":"private operation"}', { status: 403 })
        : Response.json({ status: 202, body: '{"saved":true}' });
    };
    const dependencies = Layer.mergeAll(
      Layer.mock(ExecutionRequests.ExecutionRequestService)({}),
      Layer.mock(Environment.ServerEnvironmentIdentity)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("trusted-environment")),
      }),
      Layer.succeed(HostProcess.Environment, {
        MATION_URL: "http://mation.test",
        MATION_SERVICE_TOKEN: "fixture-token",
      }),
      FileSystem.layerNoop({}),
      FetchHttpClient.layer,
    );
    return Effect.gen(function* () {
      const service = yield* Execution.AutomationExecutionService;
      expect(yield* service.frontendRequest({ path: "overview", method: "GET" })).toEqual({
        status: 202,
        body: '{"saved":true}',
      });
      expect(
        (yield* service.frontendRequest({ path: "email/reports", method: "POST", body: "{}" }))
          .status,
      ).toBe(403);
      expect(forwarded).toEqual([
        {
          url: "http://mation.test/api/frontend/request",
          body: {
            environmentId: "trusted-environment",
            request: { path: "overview", method: "GET" },
          },
        },
        {
          url: "http://mation.test/api/frontend/request",
          body: {
            environmentId: "trusted-environment",
            request: { path: "email/reports", method: "POST", body: "{}" },
          },
        },
      ]);
    }).pipe(
      Effect.provide(Execution.layer.pipe(Layer.provide(dependencies))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
  },
);
