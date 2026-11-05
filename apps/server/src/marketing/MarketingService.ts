import { MarketingStore } from "@highstakes/marketing/server";
import {
  AgentCommand,
  HumanCommand,
  MarketingError,
  type Draft,
} from "@highstakes/marketing/contracts";
import { linkedInPublisher } from "@highstakes/marketing/linkedin";
import { verifiedReleases } from "@highstakes/marketing/releases";
import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  RunId,
  type MarketingReleaseCollectionRequest,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as NodeBuffer from "node:buffer";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Config from "../config.ts";
import * as Processes from "../processRunner.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Projects from "../project/ProjectService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

export class MarketingFailure extends Schema.TaggedError<MarketingFailure>()("MarketingFailure", {
  reason: Schema.Literals(["invalid", "conflict", "forbidden", "unavailable"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message() {
    return {
      invalid: "The release Studio request is incomplete or invalid.",
      conflict: "The release draft changed. Refresh Studio and try again.",
      forbidden: "This chat or approval cannot change that release draft.",
      unavailable: "The release Studio could not finish this operation. Check its saved blocker.",
    }[this.reason];
  }
}
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const failure = (cause: unknown) =>
  new MarketingFailure({
    reason: cause instanceof MarketingError ? cause.reason : "unavailable",
    cause,
  });
export class MarketingService extends Context.Service<
  MarketingService,
  {
    readonly context: (
      threadId: string,
    ) => Effect.Effect<
      { draft: Draft | null; publishingConfigured: boolean; publishingReason: string | null },
      MarketingFailure
    >;
    readonly human: (
      threadId: string,
      command: typeof HumanCommand.Type,
    ) => Effect.Effect<Draft, MarketingFailure>;
    readonly agent: (
      caller: { threadId: string; runId: string },
      command: typeof AgentCommand.Type,
    ) => Effect.Effect<Draft, MarketingFailure>;
    readonly collect: (
      input: MarketingReleaseCollectionRequest,
    ) => Effect.Effect<{ imported: number; checkedAt: string }, MarketingFailure>;
  }
>()("t3/marketing/MarketingService") {}

const make = Effect.gen(function* () {
  const config = yield* Config.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const variables = yield* HostProcess.Environment;
  const threads = yield* Threads.ThreadManagementService;
  const launch = yield* Launch.ThreadLaunchService;
  const projects = yield* Projects.ProjectService;
  yield* ServerEnvironment.ServerEnvironmentIdentity;
  const process = yield* Processes.ProcessRunner;
  // This adapter owns host facilities. Marketing owns its data and never imports T3 internals.
  const store = yield* Effect.tryPromise({
    try: () => MarketingStore.open(path.join(config.baseDir, "marketing")),
    catch: failure,
  });
  const configured = Boolean(
    variables.MARKETING_LINKEDIN_TOKEN_FILE &&
    variables.MARKETING_LINKEDIN_COMPANY_AUTHOR &&
    variables.MARKETING_LINKEDIN_VERSION,
  );
  const publisher = linkedInPublisher({
    tokenFile: variables.MARKETING_LINKEDIN_TOKEN_FILE ?? "",
    version: variables.MARKETING_LINKEDIN_VERSION ?? "",
    companyAuthor: variables.MARKETING_LINKEDIN_COMPANY_AUTHOR ?? "",
    personalAuthor: variables.MARKETING_LINKEDIN_PERSONAL_AUTHOR ?? "",
  });
  const call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: failure });
  const shell = (id: string) =>
    threads.getThreadShell(ThreadId.make(id)).pipe(
      Effect.mapError(failure),
      Effect.filterOrFail(
        (t): t is NonNullable<typeof t> => t !== null && t.deletedAt === null,
        () => new MarketingFailure({ reason: "forbidden" }),
      ),
    );
  const context = Effect.fn("marketing.context")(function* (threadId: string) {
    yield* shell(threadId);
    return {
      draft: store.read(threadId),
      publishingConfigured: configured,
      publishingReason: configured
        ? null
        : "LinkedIn publishing is not connected. The company account, API version and private credential must be configured before publication.",
    };
  });
  const deliver = Effect.fn("marketing.deliver")(function* (draft: Draft) {
    if (!draft.pendingMessage) return;
    const t = yield* threads
      .getThreadShell(ThreadId.make(draft.threadId))
      .pipe(Effect.mapError(failure));
    if (!t || t.deletedAt !== null || t.archivedAt !== null) return;
    const projection = yield* threads
      .getThreadProjection(ThreadId.make(draft.threadId))
      .pipe(Effect.mapError(failure));
    if (projection.messages.some((message) => message.id === draft.pendingMessage!.id)) {
      yield* call(() => store.delivered(draft.threadId, draft.pendingMessage!.id));
      return;
    }
    yield* threads
      .sendToThread({
        projectId: ProjectId.make(draft.projectId),
        threadId: ThreadId.make(draft.threadId),
        commandId: CommandId.make(draft.pendingMessage.id),
        messageId: MessageId.make(draft.pendingMessage.id),
        text: draft.pendingMessage.text,
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError(failure));
    yield* call(() => store.delivered(draft.threadId, draft.pendingMessage!.id));
  });
  const human = Effect.fn("marketing.human")(function* (
    threadId: string,
    command: typeof HumanCommand.Type,
  ) {
    yield* shell(threadId);
    const draft = yield* call(() => store.human(threadId, command));
    // The pending continuation is persisted first; a lost response retries its exact message identity.
    yield* deliver(draft).pipe(Effect.ignore);
    return draft;
  });
  const agent = Effect.fn("marketing.agent")(function* (
    caller: { threadId: string; runId: string },
    command: typeof AgentCommand.Type,
  ) {
    const t = yield* shell(caller.threadId);
    if (t.activeRunId !== RunId.make(caller.runId))
      return yield* new MarketingFailure({ reason: "forbidden" });
    let draft: Draft;
    switch (command.type) {
      case "refresh_accounts":
        draft = yield* call(() =>
          store.accounts(caller.threadId, command.expectedRevision, {
            company: variables.MARKETING_LINKEDIN_COMPANY_AUTHOR ?? "",
            personal: variables.MARKETING_LINKEDIN_PERSONAL_AUTHOR ?? "",
          }),
        );
        break;

      case "propose_highlights":
        draft = yield* call(() =>
          store.highlights(caller.threadId, command.expectedRevision, command.highlights),
        );
        break;
      case "save_draft":
        draft = yield* call(() =>
          store.save(
            caller.threadId,
            command.expectedRevision,
            command.companyText,
            command.personalText,
          ),
        );
        break;
      case "set_personal":
        draft = yield* call(() =>
          store.personal(caller.threadId, command.expectedRevision, command.text, command.enabled),
        );
        break;
      case "report_blocker":
        draft = yield* call(() =>
          store.blocker(caller.threadId, command.expectedRevision, command.message),
        );
        break;
      case "import_media": {
        const project = yield* projects.getById(ProjectId.make(t.projectId)).pipe(
          Effect.mapError(failure),
          Effect.flatMap((p) =>
            Effect.fromOption(p).pipe(
              Effect.mapError(() => new MarketingFailure({ reason: "forbidden" })),
            ),
          ),
        );
        const root = yield* fs
          .realPath(t.worktreePath ?? project.workspaceRoot)
          .pipe(Effect.mapError(failure));
        const file = yield* fs
          .realPath(path.resolve(root, command.filePath))
          .pipe(Effect.mapError(failure));
        const relative = path.relative(root, file);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          return yield* new MarketingFailure({ reason: "forbidden" });
        const bytes = yield* Effect.scoped(
          Effect.gen(function* () {
            const info = yield* fs.stat(file).pipe(Effect.mapError(failure));
            if (info.type !== "File" || info.size <= 0n || info.size > 5n * 1024n * 1024n)
              return yield* new MarketingFailure({ reason: "invalid" });
            const opened = yield* fs
              .open(file, { flag: "r", noFollow: true })
              .pipe(Effect.mapError(failure));
            const stat = yield* opened.stat.pipe(Effect.mapError(failure));
            if (
              stat.dev !== info.dev ||
              !Option.makeEquivalence<bigint>((a, b) => a === b)(stat.ino, info.ino) ||
              (yield* fs.realPath(file).pipe(Effect.mapError(failure))) !== file
            )
              return yield* new MarketingFailure({ reason: "invalid" });
            const buffer = new Uint8Array(5 * 1024 * 1024 + 1);
            let length = 0;
            while (length < buffer.byteLength) {
              const read = yield* opened
                .read(buffer.subarray(length))
                .pipe(Effect.mapError(failure));
              if (read === 0) break;
              length += read;
            }
            if (length === 0 || length > 5 * 1024 * 1024)
              return yield* new MarketingFailure({ reason: "invalid" });
            return buffer.subarray(0, length);
          }),
        );
        const mimeType =
          bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
            ? "image/png"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              ? "image/jpeg"
              : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
                  String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
                ? "image/webp"
                : null;
        if (!mimeType) return yield* new MarketingFailure({ reason: "invalid" });
        const base64 = NodeBuffer.Buffer.from(bytes).toString("base64");
        draft = yield* call(() =>
          store.attach(caller.threadId, command.expectedRevision, {
            id: `${caller.threadId}:${command.expectedRevision}`,
            name: path.basename(file),
            mimeType,
            dataUrl: `data:${mimeType};base64,${base64}`,
            source: command.source,
            alt: command.alt,
          }),
        );
        break;
      }
      case "publish":
        if (!configured) return yield* new MarketingFailure({ reason: "unavailable" });
        draft = yield* call(() =>
          store.publish(caller.threadId, command.expectedRevision, publisher),
        );
        break;
      case "reconcile":
        if (!configured) return yield* new MarketingFailure({ reason: "unavailable" });
        draft = yield* call(() =>
          store.reconcile(
            caller.threadId,
            command.expectedRevision,
            command.channel,
            command.urn,
            publisher,
          ),
        );
        break;
    }
    return draft;
  });
  const collect = Effect.fn("marketing.collect")(function* (
    input: MarketingReleaseCollectionRequest,
  ) {
    const project = yield* projects.getById(input.target.projectId).pipe(
      Effect.mapError(failure),
      Effect.flatMap((p) =>
        Effect.fromOption(p).pipe(
          Effect.mapError(() => new MarketingFailure({ reason: "forbidden" })),
        ),
      ),
    );
    const read = (resource: string) =>
      process
        .run({
          command: "gh",
          args: ["api", `repos/recuut/platform/${resource}`],
          cwd: project.workspaceRoot,
          timeout: "30 seconds",
          maxOutputBytes: 2 * 1024 * 1024,
        })
        .pipe(
          Effect.mapError(failure),
          Effect.flatMap((result) =>
            result.code === 0
              ? decodeJson(result.stdout).pipe(Effect.mapError(failure))
              : Effect.fail(new MarketingFailure({ reason: "unavailable" })),
          ),
        );
    const verified = yield* verifiedReleases(read, store.releaseIds(), input.releaseId).pipe(
      Effect.mapError(failure),
    );
    let imported = 0;
    const candidates = [
      ...verified,
      ...store
        .pending()
        .filter(
          (d) =>
            (input.releaseId === undefined || d.release.id === input.releaseId) &&
            !verified.some((r) => r.id === d.release.id),
        )
        .map((d) => d.release),
    ];
    for (const release of candidates) {
      const threadId = `marketing-release:${release.id}`;
      const result = yield* call(() =>
        store.create(release, project.id, threadId, {
          company: variables.MARKETING_LINKEDIN_COMPANY_AUTHOR ?? "",
          personal: variables.MARKETING_LINKEDIN_PERSONAL_AUTHOR ?? "",
        }),
      );
      const existing = yield* threads
        .getThreadShell(ThreadId.make(threadId))
        .pipe(Effect.mapError(failure));
      if (!existing) {
        const message = result.draft.pendingMessage!;
        yield* launch
          .launch({
            commandId: CommandId.make(`marketing-launch:${release.id}`),
            threadId: ThreadId.make(threadId),
            projectId: project.id,
            title: `recuut ${release.tag} · release update`,
            modelSelection: input.target.modelSelection,
            runtimeMode: input.target.runtimeMode,
            interactionMode: "default",
            workspaceStrategy: input.target.workspaceStrategy,
            initialMessage: {
              messageId: MessageId.make(message.id),
              text: message.text,
              attachments: [],
            },
            createdBy: "user",
            creationSource: "server",
          })
          .pipe(Effect.mapError(failure));
        yield* call(() => store.delivered(threadId, message.id));
      }
      if (result.created) imported++;
    }
    return { imported, checkedAt: DateTime.formatIso(yield* DateTime.now) };
  });
  // Delivery retries are execution handoffs, not automation schedules. They retain saved message IDs.
  yield* Effect.gen(function* () {
    for (const draft of store.pending()) yield* deliver(draft).pipe(Effect.ignore);
  }).pipe(Effect.repeat(Schedule.spaced("10 seconds")), Effect.forkScoped);
  return MarketingService.of({ context, human, agent, collect });
});
export const layer = Layer.effect(MarketingService, make);
