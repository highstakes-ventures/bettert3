import { NodeWS } from "@effect/platform-node/NodeSocket";
import {
  CloudChatError,
  CodexSettings,
  resolveProviderInstanceEnabled,
  type CloudChatReadInput,
  type CloudChatSummary,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
});
const Turns = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, items: Schema.Array(Item) })),
  nextCursor: Schema.NullOr(Schema.String),
});
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
type TurnsPage = typeof Turns.Type;
type CloudRequest = (method: string, params: unknown) => Effect.Effect<unknown, CloudChatError>;

function messageText(item: typeof Item.Type): string {
  return item.type === "agentMessage"
    ? (item.text ?? "")
    : (item.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
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
            const fail = () => {
              const error = new CloudChatError({ reason: "connection" });
              reject(error);
              for (const request of pending.values()) request.reject(error);
              pending.clear();
            };
            const abort = () => {
              fail();
              socket.terminate();
            };
            signal.addEventListener("abort", abort, { once: true });
            socket.on("error", fail);
            socket.on("close", fail);
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
                fail();
                socket.terminate();
              }
            });
            socket.once("open", () =>
              resolve({
                request: (method, params) =>
                  Effect.tryPromise({
                    try: (requestSignal) =>
                      new Promise<unknown>((done, failed) => {
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
                        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
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
                close: () => {
                  signal.removeEventListener("abort", abort);
                  socket.terminate();
                  fail();
                },
              }),
            );
          },
        ),
      catch: () => new CloudChatError({ reason: "connection" }),
    }),
    (connection) => Effect.sync(connection.close),
  );

export class CodexCloudChats extends Context.Service<
  CodexCloudChats,
  {
    readonly list: () => Effect.Effect<
      { accountId: string; chats: ReadonlyArray<CloudChatSummary>; hasMore: boolean },
      CloudChatError
    >;
    readonly read: (input: CloudChatReadInput) => Effect.Effect<
      {
        threadId: string;
        messages: ReadonlyArray<{ id: string; role: "user" | "assistant"; text: string }>;
        nextCursor: string | null;
      },
      CloudChatError
    >;
  }
>()("t3/provider/CodexCloudChats") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const cwd = yield* HostProcess.WorkingDirectory;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const withCloud = <A>(
    expectedAccount: string | null,
    operation: (request: CloudRequest, accountId: string) => Effect.Effect<A, CloudChatError>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* settings.getSettings.pipe(
          Effect.mapError(() => new CloudChatError({ reason: "authentication" })),
        );
        const configured = Object.values(current.providerInstances).filter(
          (p) => p.driver === "codex",
        );
        const instance = configured.find(resolveProviderInstanceEnabled);
        // An unconfigured T3 uses its default CLI login. Explicit account settings must
        // never fall through to that login when every configured instance is disabled.
        if (configured.length > 0 && !instance)
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
        const connection = yield* connect(token, accountId);
        yield* connection.request("initialize", {
          clientInfo: { name: "t3_cloud_chats", title: "T3 Cloud chats", version: "0.0.45" },
          capabilities: { experimentalApi: true },
        });
        connection.notify();
        return yield* operation(connection.request, accountId);
      }),
    ).pipe(
      Effect.timeout("60 seconds"),
      Effect.catchTags({ TimeoutError: () => new CloudChatError({ reason: "connection" }) }),
    );
  const turns = (request: CloudRequest, threadId: string, limit: number, cursor?: string) =>
    request("thread/turns/list", {
      threadId,
      limit,
      cursor: cursor ?? null,
      sortDirection: "asc",
      itemsView: "full",
    }).pipe(
      Effect.flatMap((value) =>
        decodeTurns(value).pipe(Effect.mapError(() => new CloudChatError({ reason: "protocol" }))),
      ),
    );
  let cachedAccount: string | null = null;
  const summaries = new Map<
    string,
    { title: string; provenance: ReturnType<typeof cloudChatOrigin> }
  >();
  return CodexCloudChats.of({
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
                let summary = summaries.get(thread.id);
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
                return {
                  id: thread.id,
                  title: thread.name?.trim() || summary.title,
                  createdAt: thread.createdAt,
                  updatedAt: thread.updatedAt,
                  status: thread.status.type,
                  origin: summary.provenance.origin,
                  repository: summary.provenance.repository,
                  githubRunUrl: summary.provenance.githubRunUrl,
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
          const page: TurnsPage = yield* turns(request, input.threadId, 10, input.cursor);
          return {
            threadId: input.threadId,
            nextCursor: page.nextCursor,
            messages: page.data.flatMap((turn) =>
              turn.items.flatMap((item) =>
                item.type === "userMessage" || item.type === "agentMessage"
                  ? [
                      {
                        id: item.id,
                        role:
                          item.type === "userMessage" ? ("user" as const) : ("assistant" as const),
                        text: messageText(item),
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

export const layer = Layer.effect(CodexCloudChats, make);
