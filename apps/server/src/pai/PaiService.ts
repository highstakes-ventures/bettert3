import * as Mation from "../mation/AutomationExecutionService.ts";
import {
  PaiPublishEmailResult,
  PaiWidgetPage,
  PaiEmailItem,
  PaiEmailWorkflow,
  MationRunRef,
  MationExecutionTarget,
  type PaiPublishEmailInput,
  type PaiWidgetRequest,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

export class PaiOperationError extends Schema.TaggedError<PaiOperationError>()(
  "PaiOperationError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `PAI could not ${this.operation}. Check this environment's Mation connection.`;
  }
}

type EmailCaller = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "activeRunId" | "modelSelection" | "runtimeMode" | "interactionMode"
>;

export class PaiService extends Context.Service<
  PaiService,
  {
    readonly page: Effect.Effect<{ html: string }, PaiOperationError>;
    readonly workflow: Effect.Effect<{ prompt: string }, PaiOperationError>;
    readonly request: (
      input: PaiWidgetRequest,
    ) => Effect.Effect<{ status: number; body: string }, PaiOperationError>;
    readonly publish: (
      input: PaiPublishEmailInput,
      caller: EmailCaller,
      requestId?: string,
    ) => Effect.Effect<typeof PaiPublishEmailResult.Type, PaiOperationError>;
    readonly complete: (
      input: { actionId: string; message: string },
      caller: EmailCaller,
    ) => Effect.Effect<{ completed: boolean }, PaiOperationError>;
  }
>()("t3/pai/PaiService") {}

const encodeReport = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      source: MationRunRef,
      target: MationExecutionTarget,
      items: Schema.Array(PaiEmailItem),
    }),
  ),
);
const encodeCompletion = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ source: MationRunRef, message: Schema.String })),
);

const make = Effect.gen(function* () {
  const mation = yield* Mation.AutomationExecutionService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const proxy = Effect.fn("mation.pai.request")(function* (
    path: string,
    method: "GET" | "POST",
    body?: string,
  ) {
    const response = yield* mation
      .proxy(
        path,
        method,
        body === undefined ? undefined : new TextEncoder().encode(body),
        "application/json",
      )
      .pipe(
        Effect.mapError(
          (cause) => new PaiOperationError({ operation: "connect to Mation", cause }),
        ),
      );
    return { status: response.status, body: new TextDecoder().decode(response.body) };
  });
  const decode = <A, I>(schema: Schema.Codec<A, I>, result: { status: number; body: string }) =>
    result.status < 200 || result.status >= 300
      ? Effect.fail(
          new PaiOperationError({
            operation: "complete the request",
            cause: `PAI returned HTTP ${result.status}.`,
          }),
        )
      : Schema.decodeEffect(Schema.fromJsonString(schema))(result.body).pipe(
          Effect.mapError(
            (cause) => new PaiOperationError({ operation: "read its response", cause }),
          ),
        );
  return PaiService.of({
    workflow: proxy("/api/email/workflow", "GET").pipe(
      Effect.flatMap((result) => decode(PaiEmailWorkflow, result)),
    ),
    page: proxy("/api/email/widget", "GET").pipe(
      Effect.flatMap((result) => decode(PaiWidgetPage, result)),
    ),
    request: Effect.fn("pai.widgetRequest")(function* (input: PaiWidgetRequest) {
      const environmentId = yield* environment.getEnvironmentId;
      const path = `/api/email/reports/${input.reportId}${input.method === "POST" ? "/actions" : ""}?${new URLSearchParams({ environmentId })}`;
      return yield* proxy(path, input.method, input.method === "POST" ? input.body : undefined);
    }),
    publish: Effect.fn("pai.publishEmails")(function* (
      input: PaiPublishEmailInput,
      caller: EmailCaller,
      requestId?: string,
    ) {
      if (caller.activeRunId === null)
        return yield* new PaiOperationError({
          operation: "publish outside an active run",
          cause: "The reporting run ended.",
        });
      if (requestId !== undefined)
        yield* mation
          .assertCaller(requestId, { threadId: caller.id, runId: caller.activeRunId })
          .pipe(
            Effect.mapError(
              (cause) => new PaiOperationError({ operation: "validate the Mation source", cause }),
            ),
          );
      const source = {
        environmentId: yield* environment.getEnvironmentId,
        threadId: caller.id,
        runId: caller.activeRunId,
      };
      const target = {
        projectId: caller.projectId,
        threadId: null,
        workspaceStrategy: { type: "root" as const },
        modelSelection: caller.modelSelection,
        runtimeMode: caller.runtimeMode,
        interactionMode: caller.interactionMode,
      };
      const body = yield* encodeReport({ source, target, items: input.items }).pipe(
        Effect.mapError(
          (cause) => new PaiOperationError({ operation: "encode its report", cause }),
        ),
      );
      const result = yield* proxy("/api/email/reports", "POST", body);
      return yield* decode(PaiPublishEmailResult, result);
    }),
    complete: Effect.fn("pai.completeEmailAction")(function* (
      input: { actionId: string; message: string },
      caller: EmailCaller,
    ) {
      if (caller.activeRunId === null)
        return yield* new PaiOperationError({
          operation: "complete outside an active run",
          cause: "The action run ended.",
        });
      // A reply supplying missing context can be a later run in this dedicated action chat.
      const execution = yield* mation
        .get(input.actionId, { projectId: caller.projectId, threadId: caller.id })
        .pipe(
          Effect.mapError(
            (cause) => new PaiOperationError({ operation: "validate the action chat", cause }),
          ),
        );
      const source = execution.ref;
      const body = yield* encodeCompletion({ source, message: input.message }).pipe(
        Effect.mapError(
          (cause) => new PaiOperationError({ operation: "encode its result", cause }),
        ),
      );
      const result = yield* proxy(`/api/email/actions/${input.actionId}/complete`, "POST", body);
      return yield* decode(Schema.Struct({ completed: Schema.Boolean }), result);
    }),
  });
});
export const layer = Layer.effect(PaiService, make);
