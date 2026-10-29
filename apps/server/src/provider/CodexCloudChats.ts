import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ProviderInstanceId, type CodexCloudDestination } from "@t3tools/contracts";
import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexError from "effect-codex-app-server/errors";
import type * as Scope from "effect/Scope";
import * as CodexCloudTransport from "./CodexCloudTransport.ts";
import { NodeWS } from "@effect/platform-node/NodeSocket";
import {
  CloudChatError,
  CodexSettings,
  resolveProviderInstanceEnabled,
  type CloudChatReadInput,
  type CloudChatReadResult,
  type CloudChatSummary,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { decodeJwt } from "jose";
import * as ServerSettings from "../serverSettings.ts";
import { withCodexAppServerClient } from "./CodexProvider.ts";
import { cloudChatOrigin } from "./cloudChatOrigin.ts";

const Thread = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  preview: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  status: Schema.Struct({ type: Schema.String }),
  threadSource: Schema.optional(Schema.NullOr(Schema.String)),
  parentThreadId: Schema.optional(Schema.NullOr(Schema.String)),
  ephemeral: Schema.optional(Schema.Boolean),
});
const ThreadList = Schema.Struct({
  data: Schema.Array(Thread),
  nextCursor: Schema.NullOr(Schema.String),
});
const Item = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  text: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  aggregatedOutput: Schema.optional(Schema.NullOr(Schema.String)),
  server: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  summary: Schema.optional(Schema.Array(Schema.String)),
  content: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.String,
        Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
      ]),
    ),
  ),
});
const Turns = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      items: Schema.Array(Item),
      status: Schema.optional(Schema.String),
      startedAt: Schema.optional(Schema.NullOr(Schema.Number)),
      completedAt: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});
const CloudThread = Schema.Struct({
  ...Thread.fields,
  model: Schema.NullOr(Schema.String),
  canAcceptDirectInput: Schema.NullOr(Schema.Boolean),
  environments: Schema.Array(
    Schema.Struct({
      environmentId: Schema.String,
      cwd: Schema.String.check(Schema.isPattern(/^\//)),
    }),
  ),
});
const decodeCloudThread = Schema.decodeUnknownEffect(Schema.Struct({ thread: CloudThread }));
export type CloudThreadSnapshot = {
  readonly instanceId: ProviderInstanceId;
  readonly destination: CodexCloudDestination;
  readonly thread: typeof CloudThread.Type;
  readonly turns: ReadonlyArray<(typeof Turns.Type.data)[number]>;
};

const Reply = Schema.Struct({
  id: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
});
const Claims = Schema.Struct({
  "https://api.openai.com/auth": Schema.Struct({ chatgpt_account_id: Schema.String }),
});
const decodeReply = Schema.decodeUnknownSync(Reply);
const decodeConfig = Schema.decodeEffect(CodexSettings);
const decodeClaims = Schema.decodeUnknownEffect(Claims);
const decodeTurns = Schema.decodeUnknownEffect(Turns);
const decodeThreads = Schema.decodeUnknownEffect(ThreadList);
const isCloudChatError = Schema.is(CloudChatError);
class CloudIdentity extends Data.Class<{
  readonly token: string;
  readonly accountId: string;
  readonly instanceId: ProviderInstanceId;
}> {}

type TurnsPage = typeof Turns.Type;
type CloudRequest = (method: string, params: unknown) => Effect.Effect<unknown, CloudChatError>;

function messageText(item: typeof Item.Type): string {
  return item.type === "agentMessage"
    ? (item.text ?? "")
    : (item.content ?? [])
        .flatMap((c) => (typeof c !== "string" && c.type === "text" ? [c.text ?? ""] : []))
        .join("\n");
}

// The durable endpoint uses app-server JSON-RPC over WebSocket. Keep this private protocol
// at the provider boundary; it must never replace the existing local stdio transport.
const connect = (token: string, accountId: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) =>
        new Promise<{ request: CloudRequest; notify: () => void; close: () => void }>(
          (resolve, reject) => {
            const socket = new NodeWS.WebSocket(
              "wss://codex-cloud-backend.chatgpt.com/",
              ["codex-app-server", "codex-client.desktop", `openai-bearer.${token}`],
              {
                headers: {
                  "X-OpenAI-Product-Sku": "codex",
                  "X-OpenAI-Allow-Environmentless-Fallback": "true",
                  "ChatGPT-Account-Id": accountId,
                },
                handshakeTimeout: 15_000,
                maxPayload: 16 * 1024 * 1024,
              },
            );
            const pending = new Map<
              number,
              { resolve: (value: unknown) => void; reject: (error: CloudChatError) => void }
            >();
            let nextId = 1;
            let failure: CloudChatError | undefined;
            const fail = (reason: "connection" | "protocol" = "connection") => {
              if (failure) return;
              failure = new CloudChatError({ reason });
              signal.removeEventListener("abort", abort);
              reject(failure);
              for (const request of pending.values()) request.reject(failure);
              pending.clear();
              socket.terminate();
            };
            const abort = () => fail();
            signal.addEventListener("abort", abort, { once: true });
            socket.on("error", () => fail());
            socket.on("close", () => fail());
            socket.on("message", (bytes) => {
              try {
                const reply = decodeReply(JSON.parse(bytes.toString()));
                if (reply.id === undefined) return;
                const request = pending.get(reply.id);
                if (!request) return;
                pending.delete(reply.id);
                if (reply.error !== undefined)
                  request.reject(new CloudChatError({ reason: "protocol" }));
                else request.resolve(reply.result);
              } catch {
                fail("protocol");
              }
            });
            socket.once("open", () => {
              signal.removeEventListener("abort", abort);
              resolve({
                request: (method, params) =>
                  Effect.tryPromise({
                    try: (requestSignal) =>
                      new Promise<unknown>((done, failed) => {
                        if (failure || socket.readyState !== NodeWS.WebSocket.OPEN) {
                          failed(failure ?? new CloudChatError({ reason: "connection" }));
                          return;
                        }
                        const id = nextId++;
                        const cleanup = () => {
                          pending.delete(id);
                          requestSignal.removeEventListener("abort", cancel);
                        };
                        const cancel = () => {
                          cleanup();
                          failed(new CloudChatError({ reason: "connection" }));
                        };
                        requestSignal.addEventListener("abort", cancel, { once: true });
                        pending.set(id, {
                          resolve: (value) => {
                            cleanup();
                            done(value);
                          },
                          reject: (error) => {
                            cleanup();
                            failed(error);
                          },
                        });
                        try {
                          socket.send(
                            JSON.stringify({ jsonrpc: "2.0", id, method, params }),
                            (error) => {
                              if (error) fail();
                            },
                          );
                        } catch {
                          fail();
                        }
                      }),
                    catch: (error) =>
                      isCloudChatError(error)
                        ? error
                        : new CloudChatError({ reason: "connection" }),
                  }).pipe(
                    Effect.timeout("20 seconds"),
                    Effect.catchTags({
                      TimeoutError: () => new CloudChatError({ reason: "connection" }),
                    }),
                  ),
                notify: () =>
                  socket.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" })),
                close: () => fail(),
              });
            });
          },
        ),
      catch: () => new CloudChatError({ reason: "connection" }),
    }),
    (connection) => Effect.sync(connection.close),
    { interruptible: true },
  );

export class CodexCloudChats extends Context.Service<
  CodexCloudChats,
  {
    readonly destinations: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<ReadonlyArray<CodexCloudDestination>, CloudChatError>;
    readonly openClient: (
      destination: CodexCloudDestination,
      instanceId: ProviderInstanceId,
      onTermination?: (error: CodexError.CodexAppServerError) => Effect.Effect<void>,
    ) => Effect.Effect<CodexClient.CodexAppServerClient["Service"], CloudChatError, Scope.Scope>;
    readonly interrupt: (input: {
      readonly accountId: string;
      readonly threadId: string;
      readonly turnId: string;
    }) => Effect.Effect<void, CloudChatError>;
    readonly snapshot: (
      input: CloudChatReadInput,
      knownCompletedTurns?: ReadonlySet<string>,
    ) => Effect.Effect<CloudThreadSnapshot, CloudChatError>;
    readonly list: () => Effect.Effect<
      { accountId: string; chats: ReadonlyArray<CloudChatSummary>; hasMore: boolean },
      CloudChatError
    >;
    readonly read: (
      input: CloudChatReadInput,
    ) => Effect.Effect<typeof CloudChatReadResult.Type, CloudChatError>;
  }
>()("t3/provider/CodexCloudChats") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const cwd = yield* HostProcess.WorkingDirectory;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;
  const authenticate = Effect.fn("CodexCloudChats.authenticate")(function* (
    expectedAccount: string | null,
    instanceId: ProviderInstanceId = ProviderInstanceId.make("codex"),
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => new CloudChatError({ reason: "authentication" })),
        );
        // Cloud history belongs to the default CLI account, independent of custom accounts.
        const instance = current.providerInstances[instanceId];
        if (!instance && instanceId !== "codex")
          return yield* new CloudChatError({ reason: "authentication" });
        if (instance && (instance.driver !== "codex" || !resolveProviderInstanceEnabled(instance)))
          return yield* new CloudChatError({ reason: "authentication" });
        const config = yield* decodeConfig(instance?.config ?? {}).pipe(
          Effect.mapError(() => new CloudChatError({ reason: "authentication" })),
        );
        if (config.setupMode === "managed")
          return yield* new CloudChatError({ reason: "authentication" });
        const environment = yield* mergeProviderInstanceEnvironment(instance?.environment);
        const { client } = yield* withCodexAppServerClient({
          binaryPath: config.binaryPath,
          homePath: config.shadowHomePath || config.homePath || undefined,
          launchArgs: config.launchArgs,
          environment,
          cwd,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.mapError(() => new CloudChatError({ reason: "authentication" })),
        );
        const auth = yield* client
          .request("getAuthStatus", { includeToken: true, refreshToken: false })
          .pipe(Effect.mapError(() => new CloudChatError({ reason: "authentication" })));
        const token = auth.authToken;
        if (!token || auth.authMethod !== "chatgpt")
          return yield* new CloudChatError({ reason: "authentication" });
        const claims = yield* Effect.try({
          try: () => decodeJwt(token),
          catch: () => new CloudChatError({ reason: "authentication" }),
        });
        const parsedClaims = yield* decodeClaims(claims).pipe(
          Effect.mapError(() => new CloudChatError({ reason: "authentication" })),
        );
        const accountId = parsedClaims["https://api.openai.com/auth"].chatgpt_account_id;
        if (expectedAccount !== null && accountId !== expectedAccount)
          return yield* new CloudChatError({ reason: "accountChanged" });
        return { token, accountId, instanceId };
      }),
    );
  });
  const catalog = Effect.fn("CodexCloudChats.catalog")(function* (auth: {
    token: string;
    accountId: string;
  }) {
    const destinations: Array<CodexCloudDestination> = [];
    for (const scope of ["user", "workspace"]) {
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({
          scope,
          limit: "100",
          omitDraft: "true",
          view: "picker",
          ...(cursor ? { cursor } : {}),
        });
        const response = yield* http
          .execute(
            HttpClientRequest.get(
              `https://codex-cloud-backend.chatgpt.com/v1/environment-configs?${query}`,
            ).pipe(
              HttpClientRequest.bearerToken(auth.token),
              HttpClientRequest.setHeader("ChatGPT-Account-Id", auth.accountId),
              HttpClientRequest.setHeader("X-OpenAI-Product-Sku", "codex"),
            ),
          )
          .pipe(
            Effect.timeout("20 seconds"),
            Effect.mapError(() => new CloudChatError({ reason: "connection" })),
          );
        if (response.status !== 200) return yield* new CloudChatError({ reason: "connection" });
        const page = yield* response.json.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
                next_cursor: Schema.NullOr(Schema.String),
              }),
            ),
          ),
          Effect.mapError(() => new CloudChatError({ reason: "protocol" })),
        );
        destinations.push(
          ...page.data.map((config) => ({
            kind: "codexCloud" as const,
            accountId: auth.accountId,
            environmentConfigId: config.id,
            name: config.name,
            cwd: "/workspace",
          })),
        );
        cursor = page.next_cursor;
      } while (cursor !== null);
    }
    return destinations;
  });
  const connections = yield* RcMap.make({
    idleTimeToLive: "30 seconds",
    lookup: Effect.fn("CodexCloudChats.connect")(
      function* (auth: CloudIdentity) {
        const connection = yield* connect(auth.token, auth.accountId);
        yield* connection.request("initialize", {
          clientInfo: { name: "t3_cloud_chats", title: "T3 Cloud chats", version: "0.0.45" },
          capabilities: { experimentalApi: true },
        });
        yield* Effect.try({
          try: connection.notify,
          catch: () => new CloudChatError({ reason: "connection" }),
        });
        return connection;
      },
      Effect.result,
      // Share acquisition failures too, so concurrent borrowers invalidate the
      // failed entry once without discarding a newer replacement.
      Effect.map((result) => ({ result, invalidated: false })),
    ),
  });
  const withCloud = Effect.fn("CodexCloudChats.withCloud")(
    function* <A>(
      expectedAccount: string | null,
      operation: (
        request: CloudRequest,
        accountId: string,
        instanceId: ProviderInstanceId,
      ) => Effect.Effect<A, CloudChatError>,
    ) {
      const auth = new CloudIdentity(yield* authenticate(expectedAccount));
      const attempt = Effect.scoped(
        Effect.gen(function* () {
          const entry = yield* RcMap.get(connections, auth);
          return yield* Effect.gen(function* () {
            if (entry.result._tag === "Failure") return yield* entry.result.failure;
            return yield* operation(entry.result.success.request, auth.accountId, auth.instanceId);
          }).pipe(
            Effect.tapError(() =>
              Effect.suspend(() => {
                if (entry.invalidated) return Effect.void;
                entry.invalidated = true;
                return RcMap.invalidate(connections, auth);
              }).pipe(Effect.uninterruptible),
            ),
          );
        }),
      );
      return yield* attempt.pipe(
        Effect.catchIf(
          (error) => error.reason === "connection",
          () => attempt,
        ),
      );
    },
    Effect.timeout("60 seconds"),
    Effect.catchTags({ TimeoutError: () => new CloudChatError({ reason: "connection" }) }),
  );
  const turns = (
    request: CloudRequest,
    threadId: string,
    limit: number,
    cursor?: string,
    sortDirection: "asc" | "desc" = "asc",
    itemsView: "full" | "notLoaded" = "full",
  ) =>
    request("thread/turns/list", {
      threadId,
      limit,
      cursor: cursor ?? null,
      sortDirection,
      itemsView,
    }).pipe(
      Effect.flatMap((value) =>
        decodeTurns(value).pipe(Effect.mapError(() => new CloudChatError({ reason: "protocol" }))),
      ),
    );
  let cachedAccount: string | null = null;
  type Summary = {
    title: string;
    provenance: ReturnType<typeof cloudChatOrigin>;
    timing?: { totalMs: number; turn: TurnsPage["data"][number] };
  };
  const summaries = new Map<string, Summary>();
  return CodexCloudChats.of({
    destinations: (instanceId) => authenticate(null, instanceId).pipe(Effect.flatMap(catalog)),
    openClient: Effect.fn("CodexCloudChats.openClient")(function* (
      ...[destination, instanceId, onTermination]: Parameters<
        CodexCloudChats["Service"]["openClient"]
      >
    ) {
      const auth = yield* authenticate(destination.accountId, instanceId);
      let verified = destination;
      if (destination.existingThreadId) {
        const connection = yield* connect(auth.token, auth.accountId);
        yield* connection.request("initialize", {
          clientInfo: { name: "t3_cloud_binding", version: "0.0.45" },
          capabilities: { experimentalApi: true },
        });
        yield* Effect.sync(connection.notify);
        const response = yield* connection.request("thread/read", {
          threadId: destination.existingThreadId,
          includeTurns: false,
        });
        const { thread } = yield* decodeCloudThread(response).pipe(
          Effect.mapError(() => new CloudChatError({ reason: "protocol" })),
        );
        if (
          thread.id !== destination.existingThreadId ||
          thread.canAcceptDirectInput === false ||
          thread.environments.length !== 1 ||
          thread.environments[0]?.cwd !== destination.cwd
        )
          return yield* new CloudChatError({ reason: "protocol" });
      } else {
        const choices = yield* catalog(auth);
        const choice = choices.find(
          (choice) => choice.environmentConfigId === destination.environmentConfigId,
        );
        if (!choice || destination.cwd !== choice.cwd)
          return yield* new CloudChatError({ reason: "protocol" });
        verified = choice;
      }
      return yield* CodexCloudTransport.open({
        token: auth.token,
        destination: verified,
        onTermination,
      }).pipe(Effect.mapError(() => new CloudChatError({ reason: "connection" })));
    }),
    interrupt: (input) =>
      withCloud(input.accountId, (request) =>
        Effect.gen(function* () {
          const page = yield* turns(request, input.threadId, 25, undefined, "desc", "notLoaded");
          const turn = page.data.find((turn) => turn.id === input.turnId);
          if (!turn) return yield* new CloudChatError({ reason: "protocol" });
          if (turn.status === "inProgress")
            yield* request("turn/interrupt", { threadId: input.threadId, turnId: input.turnId });
        }),
      ),
    snapshot: (input, knownCompletedTurns = new Set()) =>
      withCloud(input.accountId, (request, accountId, instanceId) =>
        Effect.gen(function* () {
          const response = yield* request("thread/read", {
            threadId: input.threadId,
            includeTurns: false,
          });
          const { thread } = yield* decodeCloudThread(response).pipe(
            Effect.mapError(() => new CloudChatError({ reason: "protocol" })),
          );
          const environment = thread.environments[0];
          if (
            thread.id !== input.threadId ||
            thread.canAcceptDirectInput === false ||
            !environment ||
            thread.environments.length !== 1
          )
            return yield* new CloudChatError({ reason: "protocol" });
          const history: Array<(typeof Turns.Type.data)[number]> = [];
          let cursor: string | undefined;
          do {
            const page = yield* turns(request, input.threadId, 25, cursor, "desc");
            history.push(...page.data.filter((turn) => !knownCompletedTurns.has(turn.id)));
            if (page.data.some((turn) => knownCompletedTurns.has(turn.id))) break;
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          const first = history.at(-1)?.items.find((item) => item.type === "userMessage");
          const provenance =
            summaries.get(input.threadId)?.provenance ??
            cloudChatOrigin(thread.threadSource, first ? messageText(first) : "");
          return {
            instanceId,
            destination: {
              kind: "codexCloud" as const,
              accountId,
              existingThreadId: thread.id,
              name: thread.name || provenance.title || thread.preview || "Cloud chat",
              cwd: environment.cwd,
              origin: provenance.origin,
              githubRunUrl: provenance.githubRunUrl,
            },
            thread,
            turns: history.toReversed(),
          };
        }),
      ),
    list: () =>
      withCloud(null, (request, accountId) =>
        Effect.gen(function* () {
          if (cachedAccount !== accountId) {
            summaries.clear();
            cachedAccount = accountId;
          }
          const accountSummaries = cachedAccount;
          const page = yield* request("thread/list", {
            cursor: null,
            limit: 100,
            archived: false,
            sourceKinds: [],
            useStateDbOnly: true,
            sortKey: "created_at",
          }).pipe(
            Effect.flatMap((value) =>
              decodeThreads(value).pipe(
                Effect.mapError(() => new CloudChatError({ reason: "protocol" })),
              ),
            ),
          );
          const visible = page.data.filter(
            (t) => !t.ephemeral && !t.parentThreadId && t.threadSource !== "chatgpt_hidden",
          );
          const chats = yield* Effect.forEach(
            visible,
            (thread) =>
              Effect.gen(function* () {
                let summary: Summary | undefined =
                  thread.threadSource === "user" && thread.name?.trim()
                    ? {
                        title: thread.name.trim(),
                        provenance: cloudChatOrigin(thread.threadSource, ""),
                      }
                    : summaries.get(thread.id);
                if (!summary) {
                  const history = yield* turns(request, thread.id, 1).pipe(Effect.result);
                  const first =
                    history._tag === "Success"
                      ? history.success.data
                          .flatMap((t) => t.items)
                          .find((i) => i.type === "userMessage")
                      : undefined;
                  const text = first ? messageText(first) : "";
                  const provenance = cloudChatOrigin(thread.threadSource, text);
                  summary = {
                    provenance,
                    title:
                      provenance.title?.trim() ||
                      thread.name?.trim() ||
                      text
                        .split("\n")
                        .find((line) => line.trim())
                        ?.slice(0, 100) ||
                      "Untitled cloud chat",
                  };
                  if (text.trim().length > 0 && cachedAccount === accountSummaries)
                    summaries.set(thread.id, summary);
                }
                let status = thread.status.type;
                let latestTurn: CloudChatSummary["latestTurn"];
                let completedRunDurationMs: number | null = null;
                if (summary.provenance.origin === "automatic") {
                  // Always refresh current activity. Settled turn metadata is reused
                  // from this account's summary, without downloading tool output.
                  const latest = yield* turns(
                    request,
                    thread.id,
                    1,
                    undefined,
                    "desc",
                    "notLoaded",
                  ).pipe(Effect.result);
                  const turn = latest._tag === "Success" ? latest.success.data[0] : undefined;
                  latestTurn = turn
                    ? { startedAt: turn.startedAt ?? null, completedAt: turn.completedAt ?? null }
                    : null;
                  if (latest._tag === "Success") {
                    let metadata: TurnsPage | null = latest.success;
                    let total = 0;
                    let known = metadata.data.length > 0;
                    const seen = new Set<string>();
                    const cursors = new Set<string>();
                    history: while (metadata !== null) {
                      for (const item of metadata.data) {
                        const cached = summary.timing;
                        if (
                          cached &&
                          item.id === cached.turn.id &&
                          item.status === cached.turn.status &&
                          item.startedAt === cached.turn.startedAt &&
                          item.completedAt === cached.turn.completedAt
                        ) {
                          total += cached.totalMs;
                          break history;
                        }
                        if (seen.has(item.id)) continue;
                        seen.add(item.id);
                        if (item.startedAt == null) {
                          known = false;
                          continue;
                        }
                        if (item.status === "inProgress") continue;
                        if (item.completedAt == null) {
                          known = false;
                          continue;
                        }
                        total += Math.max(
                          0,
                          Math.round((item.completedAt - item.startedAt) * 1000),
                        );
                      }
                      const cursor: string | null = metadata.nextCursor;
                      if (cursor === null) break;
                      if (cursors.has(cursor)) {
                        known = false;
                        break;
                      }
                      cursors.add(cursor);
                      const older: TurnsPage | null = yield* turns(
                        request,
                        thread.id,
                        100,
                        cursor,
                        "desc",
                        "notLoaded",
                      ).pipe(Effect.orElseSucceed(() => null));
                      metadata = older;
                      if (metadata === null) known = false;
                    }
                    completedRunDurationMs = known ? total : null;
                    if (
                      known &&
                      turn &&
                      turn.status !== "inProgress" &&
                      cachedAccount === accountSummaries
                    ) {
                      summary.timing = { totalMs: total, turn };
                      summaries.set(thread.id, summary);
                    }
                  }
                  const turnStatus = turn?.status;
                  status =
                    turnStatus === "inProgress"
                      ? "active"
                      : turnStatus === "completed" ||
                          turnStatus === "interrupted" ||
                          turnStatus === "failed" ||
                          (latest._tag === "Success" && latest.success.data.length === 0)
                        ? "idle"
                        : "unknown";
                }
                return {
                  id: thread.id,
                  title: thread.name?.trim() || summary.title,
                  createdAt: thread.createdAt,
                  updatedAt: thread.updatedAt,
                  status,
                  origin: summary.provenance.origin,
                  repository: summary.provenance.repository,
                  githubRunUrl: summary.provenance.githubRunUrl,
                  ...(latestTurn !== undefined ? { latestTurn, completedRunDurationMs } : {}),
                };
              }),
            { concurrency: 4 },
          );
          return { accountId, chats, hasMore: page.nextCursor !== null };
        }),
      ),
    read: (input) =>
      withCloud(input.accountId, (request) =>
        Effect.gen(function* () {
          const page: TurnsPage = yield* turns(request, input.threadId, 10, input.cursor, "desc");
          return {
            threadId: input.threadId,
            nextCursor: page.nextCursor,
            ...(page.data[0]?.status
              ? {
                  latestTurn: {
                    id: page.data[0].id,
                    status: page.data[0].status,
                    startedAt: page.data[0].startedAt ?? null,
                  },
                }
              : {}),
            messages: page.data.toReversed().flatMap((turn) =>
              turn.items.flatMap((item) =>
                item.type === "userMessage" || item.type === "agentMessage"
                  ? [
                      {
                        id: item.id,
                        role:
                          item.type === "userMessage" ? ("user" as const) : ("assistant" as const),
                        text: messageText(item),
                        ...(turn.startedAt != null ? { createdAt: turn.startedAt } : {}),
                      },
                    ]
                  : [],
              ),
            ),
          };
        }),
      ),
  });
});

export const layer = Layer.effect(CodexCloudChats, make).pipe(Layer.provide(FetchHttpClient.layer));
