import * as Schema from "effect/Schema";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16000));
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Revision = Schema.Int.check(Schema.isGreaterThan(0));
export const Release = Schema.Struct({
  id: Id,
  tag: Id,
  url: Text,
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  publishedAt: Text,
  notes: Text,
  productionRunUrl: Text,
});
export type Release = typeof Release.Type;
export const Highlights = Schema.Struct({
  title: Text,
  summary: Text,
  items: Schema.Array(Text).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
});
export type Highlights = typeof Highlights.Type;
export const Post = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(3000)),
  author: Schema.String,
});
export const Media = Schema.Struct({
  id: Id,
  name: Id,
  mimeType: Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
  dataUrl: Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)),
  source: Text,
  alt: Text,
});
export type Media = typeof Media.Type;
export const Publication = Schema.Struct({
  image: Schema.optionalKey(Schema.String),
  attempt: Schema.optionalKey(Schema.Int),
  status: Schema.Literals(["pending", "sending", "uncertain", "published"]),
  urn: Schema.NullOr(Text),
  url: Schema.NullOr(Text),
});
export type Publication = typeof Publication.Type;
export const Draft = Schema.Struct({
  id: Id,
  revision: Revision,
  projectId: Id,
  threadId: Id,
  release: Release,
  stage: Schema.Literals([
    "selecting",
    "preparing",
    "review",
    "approved",
    "publishing",
    "published",
  ]),
  highlights: Schema.NullOr(Highlights),
  selectionApproved: Schema.Boolean,
  company: Post,
  xText: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(3000))),
  personal: Schema.Struct({ ...Post.fields, enabled: Schema.Boolean }),
  media: Schema.Array(Media).check(Schema.isMaxLength(1)),
  approvedRevision: Schema.NullOr(Revision),
  companyPublication: Publication,
  personalPublication: Publication,
  pendingMessage: Schema.NullOr(Schema.Struct({ id: Id, text: Text })),
  error: Schema.NullOr(Text),
  updatedAt: Text,
});
export type Draft = typeof Draft.Type;
export const AgentCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("refresh_accounts"), expectedRevision: Revision }),
  Schema.Struct({
    type: Schema.Literal("propose_highlights"),
    expectedRevision: Revision,
    highlights: Highlights,
  }),
  Schema.Struct({
    type: Schema.Literal("save_draft"),
    expectedRevision: Revision,
    companyText: Text,
    personalText: Schema.String.check(Schema.isMaxLength(3000)),
    xText: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(3000))),
  }),
  Schema.Struct({
    type: Schema.Literal("set_personal"),
    expectedRevision: Revision,
    text: Schema.String.check(Schema.isMaxLength(3000)),
    enabled: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("import_media"),
    expectedRevision: Revision,
    filePath: Text,
    source: Text,
    alt: Text,
  }),
  Schema.Struct({ type: Schema.Literal("publish"), expectedRevision: Revision }),
  Schema.Struct({
    type: Schema.Literal("reconcile"),
    expectedRevision: Revision,
    channel: Schema.Literals(["company", "personal"]),
    urn: Text,
  }),
  Schema.Struct({
    type: Schema.Literal("report_blocker"),
    expectedRevision: Revision,
    message: Text,
  }),
]);
export type AgentCommand = typeof AgentCommand.Type;
export const HumanCommand = Schema.Struct({
  type: Schema.Literals([
    "approve_highlights",
    "feedback",
    "approve_publication",
    "retry_delivery",
    "confirm_not_published",
  ]),
  expectedRevision: Revision,
  feedback: Schema.optionalKey(Text),
  channel: Schema.optionalKey(Schema.Literals(["company", "personal"])),
  expectedAttempt: Schema.optionalKey(Schema.Int),
});
export type HumanCommand = typeof HumanCommand.Type;
export const StudioRequest = Schema.Struct({
  threadId: Id,
  command: Schema.optionalKey(HumanCommand),
});
export type StudioRequest = typeof StudioRequest.Type;
export const StudioResponse = Schema.Struct({
  draft: Schema.NullOr(Draft),
  publishingConfigured: Schema.Boolean,
  publishingReason: Schema.NullOr(Text),
});
export type StudioResponse = typeof StudioResponse.Type;
export const AgentInput = Schema.Struct({ command: Schema.optionalKey(AgentCommand) });
export const FileState = Schema.Struct({ version: Schema.Literal(1), drafts: Schema.Array(Draft) });
export type FileState = typeof FileState.Type;

// @effect-diagnostics-next-line extendsNativeError:off -- Synchronous Studio callers catch this error by class and reason.
export class MarketingError extends Error {
  readonly reason: "conflict" | "invalid" | "forbidden" | "unavailable";
  constructor(reason: "conflict" | "invalid" | "forbidden" | "unavailable", message: string) {
    super(message);
    this.reason = reason;
    this.name = "MarketingError";
  }
}
export const initialPublication: Publication = { status: "pending", urn: null, url: null };

/** A provider confirmed this attempt did not create a post. Other failures remain uncertain. */
export class PublicationRejected extends MarketingError {
  constructor(message: string) {
    super("unavailable", message);
  }
}
