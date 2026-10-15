import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as ServerSettings from "../serverSettings.ts";
import * as CodexCloudChats from "./CodexCloudChats.ts";

const wire = vi.hoisted(() => ({
  account: "account-a",
  authMethod: "chatgpt",
  closed: 0,
  opened: 0,
  requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
  authInputs: [] as Array<{ homePath?: string; environment?: NodeJS.ProcessEnv }>,
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
            Effect.succeed({ authMethod: wire.authMethod, authToken: `e30.${claims}.signature` }),
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
        constructor() {
          super();
          wire.opened++;
          queueMicrotask(() => this.emit("open"));
        }
        send(payload: string) {
          const request = JSON.parse(payload) as {
            id?: number;
            method: string;
            params?: Record<string, unknown>;
          };
          wire.requests.push({ method: request.method, params: request.params ?? {} });
          if (request.id === undefined) return;
          if (request.method === "initialize") {
            queueMicrotask(() =>
              this.emit("message", Buffer.from(JSON.stringify({ id: request.id, result: {} }))),
            );
            return;
          }
          const result = wire.response(request.method, request.params ?? {});
          queueMicrotask(() =>
            result === "disconnect"
              ? this.emit("close")
              : this.emit("message", Buffer.from(JSON.stringify({ id: request.id, result }))),
          );
        }
        terminate() {
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
  wire.account = "account-a";
  wire.authMethod = "chatgpt";
  wire.closed = 0;
  wire.opened = 0;
  wire.requests = [];
  wire.authInputs = [];
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

it.effect(
  "lists visible root chats, preserves creation time, initializes before reading, and closes its socket",
  () =>
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
        expect(wire.closed).toBe(1);
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
      expect(wire.closed).toBe(1);
    }),
  ),
);
