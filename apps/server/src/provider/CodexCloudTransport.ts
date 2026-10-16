import { NodeWS } from "@effect/platform-node/NodeSocket";
import type { CodexCloudDestination } from "@t3tools/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexError from "effect-codex-app-server/errors";
import * as Cause from "effect/Cause";
import * as PlatformError from "effect/PlatformError";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

const Outgoing = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
});
const decodeOutgoing = Schema.decodeUnknownSync(Outgoing);
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const CollaborationMode = Schema.Struct({
  mode: Schema.Literals(["plan", "default"]),
  settings: Schema.Struct({ model: Schema.String, reasoning_effort: Schema.String }),
});
const decodeCollaborationMode = Schema.decodeUnknownSync(CollaborationMode);

// Cloud accepts additional environment bindings that the public CLI schema does not expose.
// Keep this adaptation at the transport boundary so normal Codex event ingestion is shared.
export function cloudRequest(message: unknown, destination: CodexCloudDestination) {
  const request = decodeOutgoing(message);
  if (request.method === "thread/start") {
    return {
      ...request,
      params: {
        model: request.params?.model,
        threadSource: "user",
        environments: [
          { environmentConfigId: destination.environmentConfigId, cwd: destination.cwd },
        ],
        deferredEnvironment: true,
      },
    };
  }
  if (request.method === "thread/resume") {
    return { ...request, params: { threadId: request.params?.threadId, excludeTurns: true } };
  }
  if (request.method === "turn/start") {
    // Never expose local MCP endpoints, credentials, or local workspace paths to Cloud.
    const { threadId, input, model, effort, summary, serviceTier } = request.params ?? {};
    const collaborationMode =
      request.params?.collaborationMode === undefined
        ? undefined
        : decodeCollaborationMode(request.params.collaborationMode);
    return {
      ...request,
      params: {
        threadId,
        input,
        model,
        effort,
        summary,
        // Cloud rejects the local CLI's "default" sentinel. Omission selects its default tier.
        ...(serviceTier === "default" ? {} : { serviceTier }),
        ...(collaborationMode ? { collaborationMode } : {}),
      },
    };
  }
  return request;
}

export const open = Effect.fn("CodexCloudTransport.open")(function* (input: {
  readonly token: string;
  readonly destination: CodexCloudDestination;
  readonly onTermination?:
    | ((error: CodexError.CodexAppServerError) => Effect.Effect<void>)
    | undefined;
}) {
  const incoming = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const socket = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) =>
        new Promise<NodeWS.WebSocket>((resolve, reject) => {
          const socket = new NodeWS.WebSocket(
            "wss://codex-cloud-backend.chatgpt.com/",
            ["codex-app-server", "codex-client.desktop", `openai-bearer.${input.token}`],
            {
              headers: {
                "X-OpenAI-Product-Sku": "codex",
                "X-OpenAI-Allow-Environmentless-Fallback": "true",
                "ChatGPT-Account-Id": input.destination.accountId,
              },
              handshakeTimeout: 15_000,
              maxPayload: 16 * 1024 * 1024,
            },
          );
          const abort = () => socket.terminate();
          const closed = () => {
            signal.removeEventListener("abort", abort);
            Queue.endUnsafe(incoming);
            reject(new Error("Cloud connection closed."));
          };
          signal.addEventListener("abort", abort, { once: true });
          socket.on("message", (bytes) =>
            Queue.offerUnsafe(incoming, encoder.encode(`${bytes.toString()}\n`)),
          );
          socket.on("error", closed);
          socket.on("close", closed);
          socket.once("open", () => {
            signal.removeEventListener("abort", abort);
            resolve(socket);
          });
        }),
      catch: (cause) =>
        new CodexError.CodexAppServerTransportError({ operation: "read-input-stream", cause }),
    }),
    (socket) => Effect.sync(() => socket.terminate()),
  );
  let pendingOutput = "";
  const stdio = Stdio.make({
    args: Effect.succeed([]),
    stdin: Stream.fromQueue(incoming),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.try({
          try: () => {
            pendingOutput +=
              typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
            const lines = pendingOutput.split("\n");
            pendingOutput = lines.pop() ?? "";
            if (socket.readyState !== NodeWS.WebSocket.OPEN)
              throw new Error("Cloud connection closed.");
            for (const line of lines) {
              if (line.trim())
                socket.send(encodeJson(cloudRequest(decodeJson(line), input.destination)));
            }
          },
          catch: (cause) =>
            PlatformError.systemError({
              _tag: "Unknown",
              module: "Stdio",
              method: "stdout",
              cause,
            }),
        }),
      ),
    stderr: () => Sink.drain,
  });
  return yield* CodexClient.make(stdio, { onTermination: input.onTermination });
});
