import { EnvironmentId, ThreadId, type OrchestratorMcpFailure } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Mation from "../../../mation/AutomationExecutionService.ts";
import * as Pai from "../../../pai/PaiService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Access from "../../McpToolAccess.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { PaiToolkit } from "./tools.ts";

it.effect.each([
  {
    name: "saved-result conflict",
    kind: "response",
    status: 409,
    body: JSON.stringify({
      error: "This action already recorded a different result.",
      private: "private-response-sentinel",
    }),
    expected: ["HTTP 409", "different result", "Do not retry"],
  },
  {
    name: "Mation source rejection",
    kind: "response",
    status: 409,
    body: JSON.stringify({ error: "Only this action's T3 run can record its result." }),
    expected: ["HTTP 409", "original T3 source", "own T3 chat"],
  },
  {
    name: "Mation service rejection",
    kind: "response",
    status: 403,
    body: JSON.stringify({ error: "Only the action's T3 run can confirm its result." }),
    expected: ["HTTP 403", "original T3 source"],
  },
  {
    name: "unrecognized HTTP rejection",
    kind: "response",
    status: 409,
    body: JSON.stringify({ error: "private-response-sentinel" }),
    expected: ["Mation rejected", "HTTP 409"],
  },
  {
    name: "HTTP failure without a JSON body",
    kind: "response",
    status: 503,
    body: "<html>private-response-sentinel</html>",
    expected: ["Mation rejected", "HTTP 503"],
  },
  {
    name: "known message with an unrelated status",
    kind: "response",
    status: 500,
    body: JSON.stringify({ error: "This action already recorded a different result." }),
    expected: ["Mation rejected", "HTTP 500"],
  },
  {
    name: "invalid JSON response",
    kind: "response",
    status: 200,
    body: "private-response-sentinel",
    expected: ["invalid PAI response", "HTTP 200", "unconfirmed"],
  },
  {
    name: "invalid completion response",
    kind: "response",
    status: 200,
    body: JSON.stringify({ completed: "private-response-sentinel" }),
    expected: ["invalid PAI response", "HTTP 200", "unconfirmed"],
  },
  { name: "transport failure", kind: "transport", expected: ["exchange", "unconfirmed"] },
  { name: "local source rejection", kind: "source", expected: ["original T3 source"] },
  { name: "inactive caller", kind: "inactive", expected: ["active thread run"] },
] as const)("PAI completion reports $name safely through MCP", (testCase) =>
  Effect.gen(function* () {
    const caller = liveThreadShell(
      ThreadId.make("action-chat"),
      testCase.kind === "inactive" ? { activeRunId: null } : {},
    );
    const environmentId = EnvironmentId.make("environment");
    let publications = 0;
    const dependencies = Layer.mergeAll(
      Layer.mock(Threads.ThreadManagementService)({ getThreadShell: () => Effect.succeed(caller) }),
      Layer.succeed(Invocation.McpInvocationContext, {
        environmentId,
        requestNamespace: "completion-test",
        thread: {
          threadId: caller.id,
          providerSessionId: "test-session",
          providerInstanceId: caller.providerInstanceId,
        },
        client: undefined,
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
      }),
      Pai.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Environment.ServerEnvironmentIdentity)({
              getEnvironmentId: Effect.succeed(environmentId),
            }),
            Layer.mock(Mation.AutomationExecutionService)({
              get: () =>
                testCase.kind === "source"
                  ? Effect.fail(
                      new Mation.MationConflictError({ requestId: "private-response-sentinel" }),
                    )
                  : Effect.succeed({
                      ref: { environmentId, threadId: caller.id, runId: caller.activeRunId! },
                      status: "completed",
                      startedAt: null,
                      completedAt: null,
                      worktreePath: null,
                      branch: null,
                    }),
              proxy: () =>
                Effect.gen(function* () {
                  publications++;
                  if (testCase.kind === "transport")
                    return yield* new Mation.MationOperationError({
                      operation: "proxy",
                      cause: new Error("private-response-sentinel"),
                    });
                  if (testCase.kind !== "response") throw new Error("Unexpected publication");
                  return {
                    status: testCase.status,
                    body: new TextEncoder().encode(testCase.body),
                    contentType: "application/json",
                  };
                }),
            }),
          ),
        ),
      ),
    );
    const toolkit = yield* PaiToolkit.pipe(
      Effect.provide(Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(dependencies))),
    );
    const results = yield* toolkit
      .handle("pai_complete_email_action", {
        actionId: "00000000-0000-4000-8000-000000000001",
        message: "Synthetic follow-up result",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    const result = results.at(-1)!.result as OrchestratorMcpFailure;
    expect(result).toMatchObject({
      _tag: "OrchestratorMcpFailure",
      code: testCase.kind === "inactive" ? "parent_not_active" : "orchestration_error",
    });
    for (const text of testCase.expected) expect(result.message).toContain(text);
    if (testCase.kind === "response" && testCase.name !== "saved-result conflict")
      expect(result.message).not.toContain("different result");
    expect(JSON.stringify({ ...result, message: result.message })).not.toContain(
      "private-response-sentinel",
    );
    expect(publications).toBe(testCase.kind === "inactive" || testCase.kind === "source" ? 0 : 1);
  }),
);
