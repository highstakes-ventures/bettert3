import {
  ScheduledTaskDeleteResult,
  ScheduledTaskError,
  ScheduledTaskListResult,
  ScheduledTaskMutationResult,
  ScheduledTask,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as Execution from "./AutomationExecutionService.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isScheduledTaskError = Schema.is(ScheduledTaskError);

export const layer = Layer.effect(
  ScheduledTasks.ScheduledTaskService,
  Effect.gen(function* () {
    const service = yield* Execution.AutomationExecutionService;
    const call = Effect.fn("MationScheduledTasks.call")(
      function* <A, I>(operation: string, input: unknown, schema: Schema.Codec<A, I>) {
        const body =
          input === undefined ? undefined : new TextEncoder().encode(yield* encodeJson(input));
        const result = yield* service.proxy(
          `/api/t3/tasks${operation ? `/${operation}` : ""}`,
          input === undefined ? "GET" : "POST",
          body,
          "application/json",
        );
        if (result.status !== 200)
          return yield* new ScheduledTaskError({
            message:
              "Mation could not change this automation. Open Mation to review its configuration or migration requirements.",
          });
        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
          new TextDecoder().decode(result.body),
        );
      },
      Effect.mapError((cause) =>
        isScheduledTaskError(cause)
          ? cause
          : new ScheduledTaskError({
              message: "Mation is unavailable. No local T3 schedule was created.",
              cause,
            }),
      ),
    );
    const list = () => call("", undefined, ScheduledTaskListResult);
    const unsupported = () =>
      Effect.fail(
        new ScheduledTaskError({
          message:
            "Manage webhook URLs and deliveries in Mation. Existing webhooks require migration before cutover.",
        }),
      );
    return ScheduledTasks.ScheduledTaskService.of({
      list,
      subscribeList: () =>
        Stream.fromEffect(list()).pipe(Stream.repeat(Schedule.spaced("5 seconds"))),
      upsert: (input) => call("upsert", input, ScheduledTaskMutationResult),
      setEnabled: (input) => call("enabled", input, ScheduledTaskMutationResult),
      delete: (input) => call("delete", input, ScheduledTaskDeleteResult),
      deleteForThread: (threadId) =>
        call("deletethread", { threadId }, Schema.Struct({})).pipe(Effect.asVoid),
      runNow: (input) =>
        call(
          "run",
          input,
          Schema.Struct({ task: ScheduledTask, threadId: Schema.NullOr(ThreadId) }),
        ),
      rotateWebhookToken: unsupported,
      listWebhookDeliveries: unsupported,
      getWebhookDelivery: unsupported,
      triggerWebhook: () => Effect.succeed({ _tag: "not_found" as const }),
    });
  }),
);
