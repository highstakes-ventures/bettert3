import {
  MationFrontendRequest,
  EnvironmentId,
  MationFrontendResponse,
  CommandId,
  MessageId,
  ThreadId,
  type RunId,
  type MationExecution,
  type MationExecutionInput,
  type MationExecutionQuery,
  type MationProjects,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpMethod } from "effect/http";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ExecutionRequests from "../orchestration-v2/ExecutionRequestService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

export class MationOperationError extends Schema.TaggedError<MationOperationError>()(
  "MationOperationError",
  { operation: Schema.Literals(["read", "start", "publish", "proxy"]), cause: Schema.Defect() },
) {
  override get message() {
    return `The Mation ${this.operation} operation could not be completed.`;
  }
}
export class MationConflictError extends Schema.TaggedError<MationConflictError>()(
  "MationConflictError",
  { requestId: Schema.String },
) {
  override get message() {
    return "This Mation request does not match its recorded T3 run.";
  }
}
export class MationNotFoundError extends Schema.TaggedError<MationNotFoundError>()(
  "MationNotFoundError",
  { requestId: Schema.String },
) {
  override get message() {
    return "The Mation execution was not found.";
  }
}
type Failure = MationOperationError | MationConflictError | MationNotFoundError;
export class AutomationExecutionService extends Context.Service<
  AutomationExecutionService,
  {
    readonly frontend: Effect.Effect<{ html: string }, MationOperationError>;
    readonly frontendRequest: (
      input: MationFrontendRequest,
    ) => Effect.Effect<MationFrontendResponse, Failure>;
    readonly projects: Effect.Effect<MationProjects, MationOperationError>;
    readonly get: (
      requestId: string,
      query: MationExecutionQuery,
    ) => Effect.Effect<MationExecution, Failure>;
    readonly start: (
      requestId: string,
      input: MationExecutionInput,
    ) => Effect.Effect<MationExecution, Failure>;
    readonly assertCaller: (
      requestId: string,
      caller: { threadId: ThreadId; runId: RunId },
    ) => Effect.Effect<void, Failure>;
    readonly proxy: (
      path: string,
      method: string,
      body?: Uint8Array,
      contentType?: string,
    ) => Effect.Effect<
      { status: number; body: Uint8Array; contentType: string },
      MationOperationError
    >;
  }
>()("t3/mation/AutomationExecutionService") {}

const encodeFrontendRequest = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      environmentId: EnvironmentId,
      request: MationFrontendRequest,
    }),
  ),
);

const make = Effect.gen(function* () {
  const execution = yield* ExecutionRequests.ExecutionRequestService;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const http = yield* HttpClient.HttpClient;
  const variables = yield* HostProcess.Environment;
  const endpoint = variables.MATION_URL;
  const fs = yield* FileSystem.FileSystem;
  const token = variables.MATION_SERVICE_TOKEN_FILE
    ? yield* fs.readFileString(variables.MATION_SERVICE_TOKEN_FILE).pipe(
        Effect.map((value) => value.trim()),
        Effect.orElseSucceed(() => undefined),
      )
    : variables.MATION_SERVICE_TOKEN;
  // Compatibility identities are owned here; execution itself is application-independent.
  const lookup = (
    requestId: string,
    query: { projectId: MationExecutionQuery["projectId"]; threadId?: ThreadId | null },
  ) => ({
    projectId: query.projectId,
    threadId: query.threadId ?? ThreadId.make(`mation-${requestId}`),
    messageId: MessageId.make(`mation-message:${requestId}`),
  });
  const failures = (requestId: string) => ({
    ExecutionOperationError: (cause: ExecutionRequests.ExecutionOperationError) =>
      Effect.fail(new MationOperationError({ operation: cause.operation, cause })),
    ExecutionConflictError: () => Effect.fail(new MationConflictError({ requestId })),
    ExecutionNotFoundError: () => Effect.fail(new MationNotFoundError({ requestId })),
  });
  const get: AutomationExecutionService["Service"]["get"] = (requestId, query) =>
    execution
      .get(CommandId.make(`mation:${requestId}`), lookup(requestId, query))
      .pipe(Effect.catchTags(failures(requestId)));
  const start: AutomationExecutionService["Service"]["start"] = (requestId, input) =>
    execution
      .start(CommandId.make(`mation:${requestId}`), {
        ...input,
        ...lookup(requestId, input.target),
      })
      .pipe(Effect.catchTags(failures(requestId)));
  const proxy = Effect.fn("mation.proxy")(function* (
    path: string | URL,
    method: string,
    body?: Uint8Array,
    contentType?: string,
  ) {
    if (!endpoint || !token)
      return yield* new MationOperationError({
        operation: "proxy",
        cause: new Error("Mation is not connected."),
      });
    const url = yield* Effect.try({
      try: () => {
        const base = new URL(endpoint);
        const url = path instanceof URL ? path : new URL(path, base);
        if (url.origin !== base.origin || url.username || url.password || url.hash)
          throw new Error("Invalid Mation path.");
        return url;
      },
      catch: (cause) => new MationOperationError({ operation: "proxy", cause }),
    });
    let request = HttpClientRequest.make(method as HttpMethod.HttpMethod)(url.href).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
    );
    if (body?.byteLength)
      request = request.pipe(HttpClientRequest.bodyUint8Array(body, contentType));
    const response = yield* http.execute(request).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new MationOperationError({ operation: "proxy", cause })),
    );
    if (Number(response.headers["content-length"] ?? "0") > 8 * 1024 * 1024)
      return yield* new MationOperationError({
        operation: "proxy",
        cause: new Error("Mation response is too large."),
      });
    const buffer = new Uint8Array(
      yield* response.arrayBuffer.pipe(
        Effect.mapError((cause) => new MationOperationError({ operation: "proxy", cause })),
      ),
    );
    if (buffer.byteLength > 8 * 1024 * 1024)
      return yield* new MationOperationError({
        operation: "proxy",
        cause: new Error("Mation response is too large."),
      });
    return {
      status: response.status,
      body: buffer,
      contentType: response.headers["content-type"] ?? "application/octet-stream",
    };
  });
  const assertCaller: AutomationExecutionService["Service"]["assertCaller"] = (requestId, caller) =>
    execution.assertCaller(MessageId.make(`mation-message:${requestId}`), caller).pipe(
      Effect.catchTags({
        ExecutionOperationError: (cause) =>
          Effect.fail(new MationOperationError({ operation: cause.operation, cause })),
        ExecutionConflictError: () => Effect.fail(new MationConflictError({ requestId })),
      }),
    );
  const frontend = proxy("/embed.html", "GET").pipe(
    Effect.flatMap((result) =>
      result.status === 200
        ? Effect.succeed({ html: new TextDecoder().decode(result.body) })
        : Effect.fail(
            new MationOperationError({
              operation: "proxy",
              cause: new Error("Build Mation's frontend before opening it."),
            }),
          ),
    ),
  );
  const frontendRequest = Effect.fn("mation.frontendRequest")(function* (
    input: MationFrontendRequest,
  ) {
    const result = yield* proxy(
      "/api/frontend/request",
      "POST",
      new TextEncoder().encode(
        yield* encodeFrontendRequest({
          environmentId: yield* environment.getEnvironmentId,
          request: input,
        }).pipe(
          Effect.mapError((cause) => new MationOperationError({ operation: "proxy", cause })),
        ),
      ),
      "application/json",
    );
    const body = new TextDecoder().decode(result.body);
    if (result.status !== 200) return { status: result.status, body };
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(MationFrontendResponse))(
      body,
    ).pipe(Effect.mapError((cause) => new MationOperationError({ operation: "proxy", cause })));
  });
  return AutomationExecutionService.of({
    frontend,
    assertCaller,
    frontendRequest,
    get,
    start,
    proxy,
    projects: execution.capabilities.pipe(
      Effect.mapError((cause) => new MationOperationError({ operation: "read", cause })),
    ),
  });
});
export const layer = Layer.effect(AutomationExecutionService, make);
