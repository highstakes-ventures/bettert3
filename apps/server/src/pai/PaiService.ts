import * as Mation from "../mation/AutomationExecutionService.ts";
import {
  PaiPublishEmailResult,
  PaiWidgetPage,
  PaiEmailItem,
  PaiPublishEmailInput,
  PaiEmailWorkflow,
  MationRunRef,
  MationExecutionTarget,
  type PaiWidgetRequest,
  type OrchestrationV2ThreadShell,
  type TodoPreparationInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

const encodePreparedTodoResult = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      requestId: Schema.String,
      result: Schema.Unknown,
      source: MationRunRef,
    }),
  ),
);
const decodeCompletionRejection = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Literals([
        "This action already recorded a different result.",
        "Only this action's T3 run can record its result.",
        "Only the action's T3 run can confirm its result.",
      ]),
    }),
  ),
);

export class PaiOperationError extends Schema.TaggedError<PaiOperationError>()(
  "PaiOperationError",
  {
    operation: Schema.String,
    reason: Schema.optional(
      Schema.Literals([
        "transport",
        "http",
        "result_conflict",
        "source_rejected",
        "inactive_caller",
        "invalid_response",
      ]),
    ),
    httpStatus: Schema.optional(Schema.Number),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    const status = this.httpStatus === undefined ? "" : ` HTTP ${this.httpStatus}.`;
    switch (this.reason) {
      case "transport":
        return "PAI could not exchange the request with Mation. The result is unconfirmed. Check this environment's Mation connection before retrying.";
      case "http":
        return `Mation rejected the PAI request.${status}`;
      case "result_conflict":
        return `Mation rejected the PAI completion.${status} This action already recorded a different result. Do not retry with a changed message. The saved result cannot be replaced.`;
      case "source_rejected":
        return `PAI could not validate the action's original T3 source.${status} Complete the action only from its own T3 chat.`;
      case "inactive_caller":
        return "PAI completion requires an active T3 run in the action's own chat.";
      case "invalid_response":
        return `Mation returned an invalid PAI response.${status} The result is unconfirmed.`;
      default:
        return `PAI could not ${this.operation}.`;
    }
  }

  static fromHttpResponse(result: { status: number; body: string }) {
    const rejection = decodeCompletionRejection(result.body);
    const error = rejection._tag === "Some" ? rejection.value.error : undefined;
    const reason =
      result.status === 409 && error === "This action already recorded a different result."
        ? "result_conflict"
        : (result.status === 409 && error === "Only this action's T3 run can record its result.") ||
            (result.status === 403 && error === "Only the action's T3 run can confirm its result.")
          ? "source_rejected"
          : "http";
    return new PaiOperationError({
      operation: "complete the request",
      reason,
      httpStatus: result.status,
      cause: `PAI returned HTTP ${result.status}.`,
    });
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
    readonly prepareTodo: (
      input: TodoPreparationInput,
      caller: EmailCaller,
    ) => Effect.Effect<{ prepared: boolean }, PaiOperationError>;
  }
>()("t3/pai/PaiService") {}

const encodeReport = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      source: MationRunRef,
      target: MationExecutionTarget,
      items: Schema.Array(PaiEmailItem),
      calendar: PaiPublishEmailInput.fields.calendar,
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
          (cause) =>
            new PaiOperationError({ operation: "connect to Mation", reason: "transport", cause }),
        ),
      );
    return { status: response.status, body: new TextDecoder().decode(response.body) };
  });
  const decode = <A, I>(schema: Schema.Codec<A, I>, result: { status: number; body: string }) =>
    result.status < 200 || result.status >= 300
      ? Effect.fail(PaiOperationError.fromHttpResponse(result))
      : Schema.decodeEffect(Schema.fromJsonString(schema))(result.body).pipe(
          Effect.mapError(
            (cause) =>
              new PaiOperationError({
                operation: "read its response",
                reason: "invalid_response",
                httpStatus: result.status,
                cause,
              }),
          ),
        );
  return PaiService.of({
    prepareTodo: Effect.fn("pai.prepareTodo")(function* (
      input: TodoPreparationInput,
      caller: EmailCaller,
    ) {
      if (caller.activeRunId === null)
        return yield* new PaiOperationError({
          operation: "prepare outside an active run",
          cause: "The preparation run ended.",
        });
      yield* mation
        .assertCaller(input.requestId, { threadId: caller.id, runId: caller.activeRunId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PaiOperationError({ operation: "validate the todo preparation run", cause }),
          ),
        );
      const { todoId, requestId, ...result } = input;
      const body = yield* encodePreparedTodoResult({
        requestId,
        result,
        source: {
          environmentId: yield* environment.getEnvironmentId,
          threadId: caller.id,
          runId: caller.activeRunId,
        },
      }).pipe(
        Effect.mapError(
          (cause) => new PaiOperationError({ operation: "encode todo preparation", cause }),
        ),
      );
      const response = yield* proxy(`/api/todo-preparations/${todoId}/result`, "POST", body);
      yield* decode(Schema.Unknown, response);
      return { prepared: true };
    }),
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
      const body = yield* encodeReport({
        source,
        target,
        items: input.items,
        calendar: input.calendar,
      }).pipe(
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
          reason: "inactive_caller",
          cause: "The action run ended.",
        });
      // A reply supplying missing context can be a later run in this dedicated action chat.
      const execution = yield* mation
        .get(input.actionId, { projectId: caller.projectId, threadId: caller.id })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PaiOperationError({
                operation: "validate the action chat",
                ...(cause._tag === "MationConflictError" || cause._tag === "MationNotFoundError"
                  ? { reason: "source_rejected" as const }
                  : {}),
                cause,
              }),
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
