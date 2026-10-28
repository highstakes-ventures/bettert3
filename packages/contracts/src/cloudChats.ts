import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

export const CodexCloudDestination = Schema.Struct({
  kind: Schema.Literal("codexCloud"),
  accountId: Schema.String,
  environmentConfigId: Schema.optional(Schema.String),
  existingThreadId: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.Literals(["user", "automatic", "unknown"])),
  githubRunUrl: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  cwd: Schema.String.check(Schema.isPattern(/^\//)),
}).check(
  Schema.makeFilter(
    (destination) => !!destination.environmentConfigId || !!destination.existingThreadId,
  ),
);
export type CodexCloudDestination = typeof CodexCloudDestination.Type;

export const CloudChatDestinationsResult = Schema.Struct({
  destinations: Schema.Array(CodexCloudDestination),
});

export const CloudChatSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  status: Schema.String,
  origin: Schema.Literals(["user", "automatic", "unknown"]),
  repository: Schema.NullOr(Schema.String),
  githubRunUrl: Schema.NullOr(Schema.String),
  /** Total duration of settled turns, absent when complete timing is unavailable. */
  completedRunDurationMs: Schema.optional(Schema.NullOr(Schema.Number)),
  latestTurn: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        startedAt: Schema.NullOr(Schema.Number),
        completedAt: Schema.NullOr(Schema.Number),
      }),
    ),
  ),
});
export type CloudChatSummary = typeof CloudChatSummary.Type;

export const CloudChatListInput = Schema.Struct({});
export const CloudChatListResult = Schema.Struct({
  accountId: Schema.String,
  chats: Schema.Array(CloudChatSummary),
  hasMore: Schema.Boolean,
});

export const CloudChatReadInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/)),
  accountId: Schema.String,
  cursor: Schema.optional(Schema.String),
});
export type CloudChatReadInput = typeof CloudChatReadInput.Type;
export const CloudChatReadResult = Schema.Struct({
  threadId: Schema.String,
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
      createdAt: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
  latestTurn: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        startedAt: Schema.NullOr(Schema.Number),
      }),
    ),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});

export const CloudChatOpenInput = Schema.Struct({
  threadId: CloudChatReadInput.fields.threadId,
  accountId: Schema.String,
});
export type CloudChatOpenInput = typeof CloudChatOpenInput.Type;
export const CloudChatOpenResult = Schema.Struct({ threadId: ThreadId });

export class CloudChatError extends Schema.TaggedError<CloudChatError>()("CloudChatError", {
  reason: Schema.Literals(["authentication", "accountChanged", "connection", "protocol"]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "authentication":
        return "Cloud chats need an existing Codex CLI ChatGPT login.";
      case "accountChanged":
        return "The Codex account changed. Refresh the cloud chat list.";
      case "connection":
        return "Could not connect to Codex Cloud. Try refreshing.";
      case "protocol":
        return "Codex Cloud returned an unsupported response.";
    }
  }
}
