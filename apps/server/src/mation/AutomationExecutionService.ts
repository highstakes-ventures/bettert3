import {
  type MationFrontendRequest,
  type MationFrontendResponse,
  CommandId,
  MessageId,
  ThreadId,
  type RunId,
  type MationExecution,
  type MationExecutionInput,
  type MationExecutionQuery,
  type MationProjects,
  MationRunRef,
  MationEmailItem,
  type MationPublishEmailInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpMethod } from "effect/http";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as CommandReceipts from "../orchestration-v2/CommandReceiptStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
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
    readonly publishEmails: (
      input: MationPublishEmailInput,
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

const encodeEmailReport = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ ref: MationRunRef, items: Schema.Array(MationEmailItem) })),
);

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const receipts = yield* CommandReceipts.CommandReceiptStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
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
  const threadFor = (requestId: string, query: MationExecutionQuery) =>
    query.threadId ?? ThreadId.make(`mation-${requestId}`);
  const inspect = Effect.fn("mation.inspectExecution")(function* (
    requestId: string,
    query: MationExecutionQuery,
  ) {
    const threadId = threadFor(requestId, query);
    const receipt = yield* receipts
      .getByCommandId(CommandId.make(`mation:${requestId}`))
      .pipe(Effect.mapError((cause) => new MationOperationError({ operation: "read", cause })));
    if (Option.isSome(receipt) && receipt.value.threadId !== threadId)
      return yield* new MationConflictError({ requestId });
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new MationOperationError({ operation: "read", cause })));
    if (!shell || shell.deletedAt !== null || shell.projectId !== query.projectId) {
      if (Option.isSome(receipt)) return yield* new MationConflictError({ requestId });
      return null;
    }
    const projection = yield* threads
      .getProjectThreadRecords({ projectId: query.projectId, threadId }, ["runs", "messages"])
      .pipe(
        Effect.catchTags({ ThreadManagementThreadNotFoundError: () => Effect.succeed(null) }),
        Effect.mapError((cause) => new MationOperationError({ operation: "read", cause })),
      );
    if (!projection) return null;
    const message = projection.messages.find(
      (message) => message.id === `mation-message:${requestId}`,
    );
    const run = projection.runs.find((run) => run.id === message?.runId);
    if (!message || !run) return null;
    return {
      message,
      execution: {
        ref: { environmentId: yield* environment.getEnvironmentId, threadId, runId: run.id },
        status: run.status,
        startedAt: run.startedAt === null ? null : DateTime.formatIso(run.startedAt),
        completedAt: run.completedAt === null ? null : DateTime.formatIso(run.completedAt),
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
      } satisfies MationExecution,
    };
  });
  const get: AutomationExecutionService["Service"]["get"] = (requestId, query) =>
    inspect(requestId, query).pipe(
      Effect.flatMap((value) =>
        value
          ? Effect.succeed(value.execution)
          : Effect.fail(new MationNotFoundError({ requestId })),
      ),
    );
  const start = Effect.fn("mation.startExecution")(function* (
    requestId: string,
    input: MationExecutionInput,
  ) {
    const query = {
      projectId: input.target.projectId,
      ...(input.target.threadId ? { threadId: input.target.threadId } : {}),
    };
    const existing = yield* inspect(requestId, query);
    if (existing) {
      if (existing.message.text !== input.prompt)
        return yield* new MationConflictError({ requestId });
      return existing.execution;
    }
    const commandId = CommandId.make(`mation:${requestId}`);
    const messageId = MessageId.make(`mation-message:${requestId}`);
    if (input.target.threadId) {
      yield* threads
        .sendToThread({
          projectId: input.target.projectId,
          threadId: input.target.threadId,
          commandId,
          messageId,
          text: input.prompt,
          attachments: [],
          mode: "queue",
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError((cause) => new MationOperationError({ operation: "start", cause })));
    } else {
      yield* launch
        .launch({
          commandId,
          threadId: threadFor(requestId, query),
          projectId: input.target.projectId,
          title: input.title,
          modelSelection: input.target.modelSelection,
          runtimeMode: input.target.runtimeMode,
          interactionMode: input.target.interactionMode,
          workspaceStrategy: input.target.workspaceStrategy,
          automationOrigin: "external",
          initialMessage: { messageId, text: input.prompt, attachments: [] },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError((cause) => new MationOperationError({ operation: "start", cause })));
    }
    return yield* get(requestId, query);
  });
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
  const publishEmails = Effect.fn("mation.publishEmails")(function* (
    input: MationPublishEmailInput,
    caller: { threadId: ThreadId; runId: RunId },
  ) {
    const projection = yield* threads
      .getThreadRecords(caller.threadId, ["messages", "runs"])
      .pipe(Effect.mapError((cause) => new MationOperationError({ operation: "publish", cause })));
    const message = projection.messages.find(
      (message) => message.id === `mation-message:${input.requestId}`,
    );
    if (!message || message.runId !== caller.runId)
      return yield* new MationConflictError({ requestId: input.requestId });
    const ref = {
      environmentId: yield* environment.getEnvironmentId,
      threadId: caller.threadId,
      runId: caller.runId,
    };
    const encoded = yield* encodeEmailReport({ ref, items: input.items }).pipe(
      Effect.mapError((cause) => new MationOperationError({ operation: "publish", cause })),
    );
    const result = yield* proxy(
      `/api/runs/${encodeURIComponent(input.requestId)}/emails`,
      "POST",
      new TextEncoder().encode(encoded),
      "application/json",
    );
    if (result.status !== 200)
      return yield* new MationOperationError({
        operation: "publish",
        cause: new Error(`Mation returned HTTP ${result.status}.`),
      });
  });
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
    const url = yield* Effect.try({
      try: () => {
        const rawPath = input.path.split("?")[0] ?? "";
        if (input.path.includes("\\") || input.path.includes("#"))
          throw new Error("Ambiguous frontend path.");
        for (const segment of rawPath.split("/")) {
          const decoded = decodeURIComponent(segment);
          if (decoded === "." || decoded === ".." || /[\\/#?]/.test(decoded))
            throw new Error("Ambiguous frontend path.");
        }
        return new URL(`/api/${input.path}`, endpoint ?? "http://mation.invalid/");
      },
      catch: () => new MationConflictError({ requestId: "frontend" }),
    });
    const pathname = url.pathname;
    const allowed =
      input.method === "GET"
        ? ["/api/overview", "/api/runs"].includes(pathname ?? "")
        : input.method === "POST"
          ? pathname === "/api/automations" ||
            /^\/api\/automations\/[^/]+\/runs$/.test(pathname ?? "") ||
            /^\/api\/emails\/[^/]+\/instructions$/.test(pathname ?? "")
          : /^\/api\/automations\/[^/]+$/.test(pathname ?? "");
    if (!allowed) return yield* new MationConflictError({ requestId: "frontend" });
    const result = yield* proxy(
      url,
      input.method,
      input.body === undefined ? undefined : new TextEncoder().encode(input.body),
      "application/json",
    );
    return { status: result.status, body: new TextDecoder().decode(result.body) };
  });
  return AutomationExecutionService.of({
    frontend,
    frontendRequest,
    get,
    start,
    proxy,
    publishEmails,
    projects: Effect.gen(function* () {
      const inventory = yield* projects.snapshot;
      const catalog = yield* providers.getProviders;
      return {
        environmentId: yield* environment.getEnvironmentId,
        projects: inventory.projects.map((project) => ({
          id: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
        })),
        models: catalog.flatMap((provider) =>
          provider.models.map((model) => ({
            instanceId: provider.instanceId,
            model: model.slug,
            label: `${provider.displayName ?? provider.instanceId} · ${model.name ?? model.slug}`,
          })),
        ),
      };
    }).pipe(Effect.mapError((cause) => new MationOperationError({ operation: "read", cause }))),
  });
});
export const layer = Layer.effect(AutomationExecutionService, make);
