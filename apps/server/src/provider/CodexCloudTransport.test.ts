import { expect, it, vi, beforeEach } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Transport from "./CodexCloudTransport.ts";

const wire = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  disconnected: false,
  closed: 0,
  disconnect: () => {},
}));
vi.mock("@effect/platform-node/NodeSocket", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    NodeWS: {
      WebSocket: class extends EventEmitter {
        static OPEN = 1;
        readyState = 1;
        constructor() {
          super();
          wire.disconnect = () => {
            this.readyState = 3;
            this.emit("close");
          };
          queueMicrotask(() => this.emit("open"));
        }
        send(text: string) {
          const request = JSON.parse(text);
          wire.sent.push(request);
          queueMicrotask(() => {
            if (wire.disconnected) {
              this.readyState = 3;
              this.emit("close");
              return;
            }
            if (request.id !== undefined)
              this.emit(
                "message",
                Buffer.from(JSON.stringify({ id: request.id, result: { ok: true } })),
              );
            this.emit(
              "message",
              Buffer.from(JSON.stringify({ method: "cloud/test", params: { text: "streamed" } })),
            );
          });
        }
        terminate() {
          wire.closed++;
          this.readyState = 3;
          this.emit("close");
        }
      },
    },
  };
});
const destination = {
  kind: "codexCloud" as const,
  accountId: "account",
  environmentConfigId: "workspace",
  name: "Cloud",
  cwd: "/workspace",
};
beforeEach(() => {
  wire.sent = [];
  wire.disconnected = false;
  wire.closed = 0;
});

it.each([undefined, "default", "priority"])("normalizes Cloud service tier %s", (serviceTier) => {
  const result = Transport.cloudRequest(
    { method: "turn/start", params: { threadId: "cloud", input: [], serviceTier } },
    destination,
  );
  const params = JSON.parse(JSON.stringify(result.params));
  if (serviceTier === "priority") expect(params.serviceTier).toBe("priority");
  else expect(params).not.toHaveProperty("serviceTier");
});

it("binds the remote workspace and excludes local execution config and MCP credentials", () => {
  const local = {
    cwd: "/Users/local",
    config: { mcp_servers: { t3: { url: "http://localhost/private", token: "private" } } },
    developerInstructions: "Local-only tools",
    model: "codex",
    threadId: "thread",
    input: [{ type: "text", text: "Hello" }],
  };
  const start = Transport.cloudRequest(
    { id: 1, method: "thread/start", params: local },
    destination,
  );
  const turn = Transport.cloudRequest({ id: 2, method: "turn/start", params: local }, destination);
  expect(JSON.stringify([start, turn])).not.toMatch(/Users|localhost|private|Local-only/);
  expect(start.params).toMatchObject({
    environments: [{ environmentConfigId: "workspace", cwd: "/workspace" }],
    deferredEnvironment: true,
  });
  expect(turn.params).toMatchObject({
    threadId: "thread",
    input: [{ type: "text", text: "Hello" }],
  });
});
effectIt.effect("delivers replies and streaming notifications and releases its socket", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* Transport.open({ token: "test", destination });
        const arrived = yield* Deferred.make<string>();
        yield* client.handleUnknownServerNotification((_method, params) =>
          Deferred.succeed(arrived, (params as { text: string }).text),
        );
        const imageInput = [
          { type: "text", text: "Compare these screenshots" },
          { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
          { type: "image", url: "data:image/jpeg;base64,c2Vjb25k" },
        ];
        const response = yield* client.raw.request("turn/start", {
          threadId: "cloud",
          input: imageInput,
        });
        expect(response).toEqual({ ok: true });
        expect(wire.sent[0]?.params).toEqual({ threadId: "cloud", input: imageInput });
        expect(yield* Deferred.await(arrived)).toBe("streamed");
      }),
    );
    expect(wire.closed).toBe(1);
  }),
);
effectIt.effect("fails an in-flight request when the Cloud socket disconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Transport.open({ token: "test", destination });
      wire.disconnected = true;
      const result = yield* client.raw.request("cloud/test", {}).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }),
  ),
);

it("preserves Plan mode without sending local developer instructions", () => {
  const result = Transport.cloudRequest(
    {
      method: "turn/start",
      params: {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "codex",
            reasoning_effort: "high",
            developer_instructions: "Local private instructions",
          },
        },
      },
    },
    destination,
  );
  expect(result.params?.collaborationMode).toEqual({
    mode: "plan",
    settings: { model: "codex", reasoning_effort: "high" },
  });
});
effectIt.effect("reports disconnection after the turn start reply has arrived", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const ended = yield* Deferred.make<void>();
      const client = yield* Transport.open({
        token: "test",
        destination,
        onTermination: () => Deferred.succeed(ended, undefined).pipe(Effect.asVoid),
      });
      expect(yield* client.raw.request("turn/start", { threadId: "cloud", input: [] })).toEqual({
        ok: true,
      });
      wire.disconnect();
      yield* Deferred.await(ended);
    }),
  ),
);
