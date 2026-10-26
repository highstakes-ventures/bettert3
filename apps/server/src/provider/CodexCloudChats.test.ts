import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient } from "effect/http";
import { beforeEach, vi } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as ServerSettings from "../serverSettings.ts";
import * as CodexCloudChats from "./CodexCloudChats.ts";

const wire = vi.hoisted(() => ({
  account: "account-a",
  credential: "credential-a",
  authMethod: "chatgpt",
  closed: 0,
  opened: 0,
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  authInputs: [] as Array<{ homePath?: string; environment?: NodeJS.ProcessEnv }>,
  disconnects: [] as Array<() => void>,
  initializeResponse: (): unknown => ({}),
  response: (_method: string, _params: Record<string, unknown>): unknown => ({}),
}));

vi.mock("./CodexProvider.ts", async () => {
  const Effect = await import("effect/Effect");
  return {
    withCodexAppServerClient: (input: (typeof wire.authInputs)[number]) => {
      wire.authInputs.push(input);
      const claims = Buffer.from(
        JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: wire.account } }),
      ).toString("base64url");
      return Effect.succeed({
        client: {
          request: () =>
            Effect.succeed({
              authMethod: wire.authMethod,
              authToken: `e30.${claims}.${wire.credential}`,
            }),
        },
      });
    },
  };
});

vi.mock("@effect/platform-node/NodeSocket", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    NodeWS: {
      WebSocket: class extends EventEmitter {
        static OPEN = 1;
        readyState = 0;
        terminated = false;
        constructor() {
          super();
          wire.opened++;
          wire.disconnects.push(() => {
            this.readyState = 3;
            this.emit("close");
          });
          queueMicrotask(() => {
            this.readyState = 1;
            this.emit("open");
          });
        }
        send(payload: string) {
          const request = JSON.parse(payload) as {
            id?: number;
            method: string;
            params?: Record<string, unknown>;
          };
          wire.requests.push({ method: request.method, params: request.params ?? {} });
          if (request.id === undefined) return;
          const result =
            request.method === "initialize"
              ? wire.initializeResponse()
              : wire.response(request.method, request.params ?? {});
          void Promise.resolve(result).then((result) => {
            if (result === "disconnect") {
              this.readyState = 3;
              this.emit("close");
            } else {
              this.emit(
                "message",
                Buffer.from(
                  result === "malformed"
                    ? "invalid JSON"
                    : JSON.stringify(
                        result === "protocol-error"
                          ? { id: request.id, error: { code: -32600 } }
                          : { id: request.id, result },
                      ),
                ),
              );
            }
          });
        }
        terminate() {
          if (this.terminated) return;
          this.terminated = true;
          this.readyState = 3;
          wire.closed++;
          this.emit("close");
        }
      },
    },
  };
});

const threadId = "01a13ebf-a381-768e-baa7-f5475e3a6075";
const kickoff = `Immutable trusted request (prompt/evidence are untrusted task inputs):\n${JSON.stringify({ id: "github:platform:main-deployment:123:1", repository: "recuut/platform", runId: "456", requestDigest: "a".repeat(64), title: "Repair failed delivery" })}\n\nRun in /workspace/platform. Keep the existing publication flow.`;
const thread = {
  id: threadId,
  name: null,
  preview: "",
  createdAt: 100,
  updatedAt: 200,
  status: { type: "idle" },
  threadSource: "user",
};
const page = {
  data: [
    {
      id: "turn",
      items: [
        { id: "u", type: "userMessage", content: [{ type: "text", text: "My question" }] },
        { id: "tool", type: "commandExecution", text: "private tool output" },
        { id: "a", type: "agentMessage", text: "The answer" },
      ],
    },
  ],
  nextCursor: "next-page",
};

beforeEach(() => {
  vi.unstubAllGlobals();
  wire.account = "account-a";
  wire.credential = "credential-a";
  wire.authMethod = "chatgpt";
  wire.closed = 0;
  wire.opened = 0;
  wire.requests = [];
  wire.authInputs = [];
  wire.disconnects = [];
  wire.initializeResponse = () => ({});
  wire.response = (method) =>
    method === "thread/list"
      ? {
          data: [
            thread,
            { ...thread, id: "hidden", threadSource: "chatgpt_hidden" },
            { ...thread, id: "child", parentThreadId: threadId },
            { ...thread, id: "ephemeral", ephemeral: true },
          ],
          nextCursor: null,
        }
      : page;
});

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) =>
  effect.pipe(
    Effect.provide(
      CodexCloudChats.layer.pipe(
        Layer.provide([ServerSettings.layerTest(settings), NodeServices.layer]),
      ),
    ),
  );

it.effect("lists visible root chats, preserves creation time, and initializes before reading", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.list();
      expect(result).toEqual({
        accountId: "account-a",
        hasMore: false,
        chats: [
          {
            id: threadId,
            title: "My question",
            origin: "user",
            createdAt: 100,
            updatedAt: 200,
            status: "idle",
            repository: null,
            githubRunUrl: null,
          },
        ],
      });
      expect(wire.requests.slice(0, 3).map((r) => r.method)).toEqual([
        "initialize",
        "initialized",
        "thread/list",
      ]);
      expect(wire.closed).toBe(0);
    }),
  ),
);

it.effect("lists named user chats without loading each conversation's turns", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      wire.response = (method) =>
        method === "thread/list"
          ? {
              data: Array.from({ length: 100 }, (_, index) => ({
                ...thread,
                id: `user-${index}`,
                name: `User chat ${index}`,
              })),
              nextCursor: null,
            }
          : page;
      const result = yield* service.list();
      expect(result.chats).toHaveLength(100);
      expect(result.chats[0]).toMatchObject({ title: "User chat 0", origin: "user" });
      expect(
        wire.requests.filter((request) => request.method === "thread/turns/list"),
      ).toHaveLength(0);
    }),
  ),
);

it.effect(
  "refreshes automatic chat activity from the newest turn rather than the list status",
  () =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        let status = "inProgress";
        wire.response = (method, params) =>
          method === "thread/list"
            ? { data: [{ ...thread, threadSource: "automation" }], nextCursor: null }
            : params.sortDirection === "desc"
              ? {
                  data: [
                    {
                      id: "latest",
                      status,
                      startedAt: 120,
                      completedAt: status === "completed" ? 180 : null,
                      items: [],
                    },
                  ],
                  nextCursor: null,
                }
              : page;

        expect((yield* service.list()).chats[0]).toMatchObject({
          status: "active",
          latestTurn: { startedAt: 120, completedAt: null },
        });
        status = "completed";
        expect((yield* service.list()).chats[0]).toMatchObject({
          status: "idle",
          latestTurn: { startedAt: 120, completedAt: 180 },
        });
        const activityReads = wire.requests.filter(
          ({ method, params }) => method === "thread/turns/list" && params.sortDirection === "desc",
        );
        expect(activityReads).toHaveLength(2);
        expect(
          activityReads.every(
            ({ params }) => params.limit === 1 && params.itemsView === "notLoaded",
          ),
        ).toBe(true);
      }),
    ),
);

it.effect.each(["protocol-error", "missing-status"])(
  "keeps automatic chats visible with unknown activity after a %s status read",
  (failure) =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        wire.response = (method, params) =>
          method === "thread/list"
            ? { data: [{ ...thread, threadSource: "automation" }], nextCursor: null }
            : params.sortDirection === "desc"
              ? failure === "protocol-error"
                ? "protocol-error"
                : { data: [{ id: "latest", items: [] }], nextCursor: null }
              : page;
        expect((yield* service.list()).chats[0]).toMatchObject({
          id: threadId,
          title: "My question",
          status: "unknown",
          latestTurn: failure === "protocol-error" ? null : { startedAt: null, completedAt: null },
        });
      }),
    ),
);

it.effect("reads a history page in order and excludes tool items", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.read({
        threadId,
        accountId: "account-a",
        cursor: "older-page",
      });
      expect(result).toEqual({
        threadId,
        messages: [
          { id: "u", role: "user", text: "My question" },
          { id: "a", role: "assistant", text: "The answer" },
        ],
        nextCursor: "next-page",
      });
      expect(wire.requests.at(-1)?.params).toMatchObject({
        cursor: "older-page",
        sortDirection: "desc",
        limit: 10,
      });
    }),
  ),
);

it.effect(
  "shares an initialized socket across list and history reads while rechecking authentication",
  () =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        yield* service.list();
        yield* service.read({ threadId, accountId: "account-a" });
        expect(wire.opened).toBe(1);
        expect(wire.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
        expect(wire.authInputs).toHaveLength(2);
        expect(wire.closed).toBe(0);
      }),
    ).pipe(Effect.tap(() => Effect.sync(() => expect(wire.closed).toBe(1)))),
);

it.effect("keeps account and credential changes on separate sockets", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      yield* service.read({ threadId, accountId: "account-a" });
      wire.credential = "credential-b";
      yield* service.read({ threadId, accountId: "account-a" });
      expect(wire.opened).toBe(2);
      wire.account = "account-b";
      const wrongAccount = yield* service
        .read({ threadId, accountId: "account-a" })
        .pipe(Effect.result);
      expect(wrongAccount).toMatchObject({
        _tag: "Failure",
        failure: { reason: "accountChanged" },
      });
      expect(wire.opened).toBe(2);
      yield* service.read({ threadId, accountId: "account-b" });
      expect(wire.opened).toBe(3);
    }),
  ),
);

it.effect(
  "closes a socket after 30 seconds without borrowers and opens a fresh one on the next read",
  () =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        const input = { threadId, accountId: "account-a" };
        yield* service.read(input);
        yield* TestClock.adjust("29 seconds");
        expect(wire.closed).toBe(0);
        yield* service.read(input);
        expect(wire.opened).toBe(1);
        yield* TestClock.adjust("29 seconds");
        expect(wire.closed).toBe(0);
        yield* TestClock.adjust("1 second");
        expect(wire.closed).toBe(1);
        yield* service.read(input);
        expect(wire.opened).toBe(2);
      }),
    ),
);

it.effect("reconnects once after an idle socket disconnects", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      const input = { threadId, accountId: "account-a" };
      yield* service.read(input);
      wire.disconnects[0]!();
      expect((yield* service.read(input)).messages.at(-1)?.text).toBe("The answer");
      expect(wire.opened).toBe(2);
      expect(wire.requests.filter((request) => request.method === "initialize")).toHaveLength(2);
    }),
  ),
);

it.effect("retries a disconnected history read once and returns the recovered result", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      let reads = 0;
      wire.response = () => (++reads === 1 ? "disconnect" : page);
      const result = yield* service.read({ threadId, accountId: "account-a" });
      expect(result.messages.at(-1)?.text).toBe("The answer");
      expect(reads).toBe(2);
      expect(wire.opened).toBe(2);
    }),
  ),
);

it.effect("replaces a failed initialization before retrying the history read", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      let initializations = 0;
      wire.initializeResponse = () => (++initializations === 1 ? "disconnect" : {});
      expect((yield* service.read({ threadId, accountId: "account-a" })).messages).toHaveLength(2);
      expect(wire.opened).toBe(2);
      expect(wire.closed).toBe(1);
      expect(
        wire.requests.filter((request) => request.method === "thread/turns/list"),
      ).toHaveLength(1);
    }),
  ),
);

it.effect("shares the replacement when concurrent reads lose the same connection", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      let reads = 0;
      wire.response = () => (++reads <= 2 ? "disconnect" : page);
      const results = yield* Effect.all(
        [threadId, "other-chat"].map((threadId) =>
          service.read({ threadId, accountId: "account-a" }),
        ),
        { concurrency: 2 },
      );
      expect(results.map((result) => result.messages.at(-1)?.text)).toEqual([
        "The answer",
        "The answer",
      ]);
      expect(wire.opened).toBe(2);
      expect(wire.closed).toBe(1);
      expect(reads).toBe(4);
    }),
  ),
);

it.effect(
  "keeps concurrent reads alive when one borrower cancels and starts idle expiry after release",
  () =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        const started = yield* Deferred.make<void>();
        const replies = new Map<string, (value: unknown) => void>();
        wire.response = (_method, params) =>
          new Promise((resolve) => {
            replies.set(String(params.threadId), resolve);
            if (replies.size === 2) Deferred.doneUnsafe(started, Exit.void);
          });
        const first = yield* service
          .read({ threadId, accountId: "account-a" })
          .pipe(Effect.forkChild);
        const second = yield* service
          .read({ threadId: "other-chat", accountId: "account-a" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        expect(wire.opened).toBe(1);
        expect(wire.requests.filter((request) => request.method === "initialize")).toHaveLength(1);
        yield* TestClock.adjust("19 seconds");
        expect(wire.closed).toBe(0);
        yield* Fiber.interrupt(first);
        expect(wire.closed).toBe(0);
        replies.get("other-chat")!(page);
        expect((yield* Fiber.join(second)).messages.at(-1)?.text).toBe("The answer");
        replies.get(threadId)!(page);
        wire.response = () => page;
        yield* service.read({ threadId, accountId: "account-a" });
        expect(wire.opened).toBe(1);
        yield* TestClock.adjust("30 seconds");
        expect(wire.closed).toBe(1);
      }),
    ),
);

it.effect.each(["protocol-error", "malformed"])("does not retry a %s reply", (reply) =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      wire.response = () => reply;
      const result = yield* service.read({ threadId, accountId: "account-a" }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "protocol" } });
      expect(wire.opened).toBe(1);
      expect(wire.closed).toBe(1);
      wire.response = () => page;
      expect((yield* service.read({ threadId, accountId: "account-a" })).messages).toHaveLength(2);
      expect(wire.opened).toBe(2);
    }),
  ),
);

it.effect("opens the newest turns in chronological order and re-reads their changing replies", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      let reply = "First progress update";
      wire.response = (_method, params) => ({
        data:
          params.sortDirection === "desc"
            ? [
                {
                  id: "latest-turn",
                  status: "inProgress",
                  startedAt: 123,
                  items: [{ id: "latest", type: "agentMessage", text: reply }],
                },
                {
                  id: "preceding-turn",
                  items: [{ id: "preceding", type: "agentMessage", text: "Earlier reply" }],
                },
              ]
            : [
                {
                  id: "oldest-turn",
                  items: [{ id: "oldest", type: "agentMessage", text: "Old kickoff reply" }],
                },
              ],
        nextCursor: "older-turns",
      });
      const input = { threadId, accountId: "account-a" };
      expect((yield* service.read(input)).messages).toEqual([
        { id: "preceding", role: "assistant", text: "Earlier reply" },
        { id: "latest", role: "assistant", text: reply, createdAt: 123 },
      ]);
      reply = "Updated progress and result";
      const refreshed = yield* service.read(input);
      expect(refreshed.messages.at(-1)?.text).toBe(reply);
      expect(refreshed.nextCursor).toBe("older-turns");
      expect(refreshed.latestTurn).toEqual({
        id: "latest-turn",
        status: "inProgress",
        startedAt: 123,
      });
    }),
  ),
);

it.effect("keeps replies readable when a turn includes reasoning content strings", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      wire.response = () => ({
        data: [
          {
            id: "turn",
            items: [
              { id: "u", type: "userMessage", content: [{ type: "text", text: "My question" }] },
              { id: "r", type: "reasoning", summary: [], content: ["Provider reasoning content"] },
              { id: "a", type: "agentMessage", text: "A readable reply" },
            ],
          },
        ],
        nextCursor: null,
      });
      expect((yield* service.read({ threadId, accountId: "account-a" })).messages).toEqual([
        { id: "u", role: "user", text: "My question" },
        { id: "a", role: "assistant", text: "A readable reply" },
      ]);
    }),
  ),
);

it.effect("refuses history after the CLI account changes before opening the cloud connection", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.read({ threadId, accountId: "account-b" }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "accountChanged" } });
      expect(wire.opened).toBe(0);
    }),
  ),
);

it.effect("uses the configured account's shadow home and environment", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      yield* service.list();
      expect(wire.authInputs[0]).toMatchObject({
        homePath: "/test/shadow",
        environment: { ACCOUNT_MARKER: "personal" },
      });
    }),
    {
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: { shadowHomePath: "/test/shadow", homePath: "/test/shared" },
          environment: [{ name: "ACCOUNT_MARKER", value: "personal" }],
        },
      },
    },
  ),
);

it.effect.each([{ setupMode: "managed" as const }, { shadowHomePath: "/test/other-account" }])(
  "keeps Cloud history on the default CLI account alongside a custom account %j",
  (config) =>
    provide(
      Effect.gen(function* () {
        const service = yield* CodexCloudChats.CodexCloudChats;
        const result = yield* service.list();
        expect(result.accountId).toBe("account-a");
        expect(result.chats[0]?.id).toBe(threadId);
        expect((yield* service.read({ threadId, accountId: result.accountId })).messages).toEqual([
          { id: "u", role: "user", text: "My question" },
          { id: "a", role: "assistant", text: "The answer" },
        ]);
        expect(wire.authInputs).toHaveLength(2);
        expect(wire.authInputs.every((input) => input.homePath === undefined)).toBe(true);
      }),
      {
        providerInstances: {
          [ProviderInstanceId.make("codex-other")]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            config,
          },
        },
      },
    ),
);

it.effect("does not use an API-key login for cloud history", () =>
  provide(
    Effect.gen(function* () {
      wire.authMethod = "apikey";
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.list().pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "authentication" } });
      expect(wire.opened).toBe(0);
    }),
  ),
);

it.effect("never falls back to the host-default account when Codex is disabled", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.list().pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "authentication" } });
      expect(wire.authInputs).toHaveLength(0);
      expect(wire.opened).toBe(0);
    }),
    {
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
        },
      },
    },
  ),
);

it.effect("rechecks a new chat whose first kickoff message has not arrived yet", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      let messageArrived = false;
      wire.response = (method) =>
        method === "thread/list"
          ? { data: [{ ...thread, threadSource: null }], nextCursor: null }
          : {
              data: messageArrived
                ? [
                    {
                      id: "turn",
                      items: [
                        {
                          id: "u",
                          type: "userMessage",
                          content: [{ type: "text", text: kickoff }],
                        },
                      ],
                    },
                  ]
                : [],
              nextCursor: null,
            };
      expect((yield* service.list()).chats[0]?.origin).toBe("unknown");
      messageArrived = true;
      expect((yield* service.list()).chats[0]).toMatchObject({
        origin: "automatic",
        title: "Repair failed delivery",
        githubRunUrl: "https://github.com/recuut/platform/actions/runs/456",
      });
    }),
  ),
);

it.effect("returns a connection error and releases the socket on a disconnect", () =>
  provide(
    Effect.gen(function* () {
      wire.response = () => "disconnect";
      const service = yield* CodexCloudChats.CodexCloudChats;
      const result = yield* service.list().pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "connection" } });
      expect(wire.opened).toBe(2);
      expect(wire.closed).toBe(2);
    }),
  ),
);

it.effect("validates the chosen Cloud workspace and account before opening execution", () =>
  provide(
    Effect.gen(function* () {
      const service = yield* CodexCloudChats.CodexCloudChats;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                data: [{ id: "workspace", name: "Actual Cloud" }],
                next_cursor: null,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        ),
      );
      const destination = {
        kind: "codexCloud" as const,
        accountId: "account-a",
        environmentConfigId: "deleted-workspace",
        name: "Spoofed",
        cwd: "/workspace",
      };
      const invalid = yield* service
        .openClient(destination, ProviderInstanceId.make("codex"))
        .pipe(Effect.scoped, Effect.result);
      expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: "protocol" } });
      const wrongAccount = yield* service
        .openClient({ ...destination, accountId: "account-b" }, ProviderInstanceId.make("codex"))
        .pipe(Effect.scoped, Effect.result);
      expect(wrongAccount).toMatchObject({
        _tag: "Failure",
        failure: { reason: "accountChanged" },
      });
      expect(wire.opened).toBe(0);
    }),
    {
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: {},
        },
      },
    },
  ),
);

it.effect.each(["codex", "codex-other", "missing-codex"])(
  "resolves the %s destination account with default settings",
  (instanceId) =>
    provide(
      Effect.gen(function* () {
        const fetch = vi.fn(
          async (request) =>
            new Response(
              JSON.stringify({
                data: String(request).includes("scope=user")
                  ? [{ id: "workspace", name: "Cloud" }]
                  : [],
                next_cursor: null,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const service = yield* CodexCloudChats.CodexCloudChats;
        const result = yield* service
          .destinations(ProviderInstanceId.make(instanceId))
          .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.result);
        if (instanceId !== "missing-codex") {
          expect(result).toMatchObject({
            _tag: "Success",
            success: [{ accountId: "account-a", environmentConfigId: "workspace" }],
          });
          expect(wire.authInputs).toHaveLength(1);
          expect(wire.authInputs[0]?.homePath).toBe(
            instanceId === "codex-other" ? "/test/other-account" : undefined,
          );
        } else {
          expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "authentication" } });
          expect(wire.authInputs).toHaveLength(0);
        }
      }),
      {
        providerInstances: {
          [ProviderInstanceId.make("codex-other")]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath: "/test/other-account" },
          },
        },
      },
    ),
);

const boundThread = {
  ...thread,
  model: "gpt-6-astra-wm",
  canAcceptDirectInput: null,
  environments: [{ environmentId: "remote-runtime", cwd: "/workspace/existing" }],
};

it.effect(
  "reads a verified existing destination and paginates its history with one authentication",
  () => {
    wire.response = (method, params) =>
      method === "thread/read"
        ? { thread: boundThread }
        : {
            data: [{ id: params.cursor ? "older" : "newer", status: "completed", items: [] }],
            nextCursor: params.cursor ? null : "older-page",
          };
    return Effect.gen(function* () {
      const cloud = yield* CodexCloudChats.CodexCloudChats;
      const snapshot = yield* cloud.snapshot({ accountId: "account-a", threadId });
      expect(snapshot.destination).toMatchObject({
        existingThreadId: threadId,
        accountId: "account-a",
        cwd: "/workspace/existing",
      });
      expect(snapshot.destination.environmentConfigId).toBeUndefined();
      expect(snapshot.turns.map((turn) => turn.id)).toEqual(["older", "newer"]);
      expect(wire.authInputs).toHaveLength(1);
      expect(wire.requests.some((request) => request.method === "thread/start")).toBe(false);
    }).pipe(provide);
  },
);

it.effect("stops history pagination at a completed turn already projected", () => {
  wire.response = (method) =>
    method === "thread/read"
      ? { thread: boundThread }
      : {
          data: [
            { id: "live", status: "inProgress", items: [] },
            { id: "known", status: "completed", items: [] },
          ],
          nextCursor: "unneeded",
        };
  return Effect.gen(function* () {
    const cloud = yield* CodexCloudChats.CodexCloudChats;
    const snapshot = yield* cloud.snapshot(
      { accountId: "account-a", threadId },
      new Set(["known"]),
    );
    expect(snapshot.turns.map((turn) => turn.id)).toEqual(["live"]);
    expect(wire.requests.filter((request) => request.method === "thread/turns/list")).toHaveLength(
      1,
    );
  }).pipe(provide);
});

it.effect.each([
  { ...boundThread, id: "wrong-thread" },
  { ...boundThread, canAcceptDirectInput: false },
  { ...boundThread, environments: [] },
  { ...boundThread, environments: [...boundThread.environments, ...boundThread.environments] },
])("refuses an ambiguous or unwritable existing Cloud binding", (invalid) => {
  wire.response = () => ({ thread: invalid });
  return Effect.gen(function* () {
    const cloud = yield* CodexCloudChats.CodexCloudChats;
    const result = yield* cloud.snapshot({ accountId: "account-a", threadId }).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "protocol" } });
    expect(wire.requests.some((request) => request.method === "thread/turns/list")).toBe(false);
  }).pipe(provide);
});

it.effect(
  "interrupts only the requested active native turn on the authenticated Cloud account",
  () => {
    wire.response = (method) =>
      method === "thread/turns/list"
        ? { data: [{ id: "active-turn", status: "inProgress", items: [] }], nextCursor: null }
        : {};
    return Effect.gen(function* () {
      const cloud = yield* CodexCloudChats.CodexCloudChats;
      yield* cloud.interrupt({ accountId: "account-a", threadId, turnId: "active-turn" });
      expect(wire.requests.filter((request) => request.method === "turn/interrupt")).toEqual([
        { method: "turn/interrupt", params: { threadId, turnId: "active-turn" } },
      ]);
      const switched = yield* cloud
        .interrupt({ accountId: "another-account", threadId, turnId: "active-turn" })
        .pipe(Effect.result);
      expect(switched).toMatchObject({ _tag: "Failure", failure: { reason: "accountChanged" } });
      expect(wire.requests.filter((request) => request.method === "turn/interrupt")).toHaveLength(
        1,
      );
    }).pipe(provide);
  },
);
