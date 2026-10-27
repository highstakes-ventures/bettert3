import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Execution from "./AutomationExecutionService.ts";
import * as Runtime from "../orchestration-v2/runtimeLayer.ts";
import * as Scheduled from "../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Launch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Folders from "../project/ManagedProjectFolders.ts";
import * as Secrets from "../secrets/SecretRequests.ts";

it.effect.each([
  { ownsSchedules: undefined, url: "http://mation.test" },
  { ownsSchedules: "0", url: "http://mation.test" },
  { ownsSchedules: "1", url: "http://mation.test" },
  { ownsSchedules: "1", url: undefined },
])(
  "Mation's explicit ownership persists through connection failure, config=%j",
  ({ ownsSchedules, url }) =>
    Effect.gen(function* () {
      const registrations: string[] = [];
      const calls: string[] = [];
      const selected = Runtime.layerScheduledTaskOwner.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Environment, {
              ...(url === undefined ? {} : { MATION_URL: url }),
              ...(ownsSchedules === undefined ? {} : { MATION_OWNS_SCHEDULES: ownsSchedules }),
            }),
            Layer.mock(Execution.AutomationExecutionService)({
              proxy: (path) =>
                Effect.sync(() => calls.push(String(path))).pipe(
                  Effect.flatMap(() =>
                    url
                      ? Effect.succeed({
                          status: 200,
                          body: new TextEncoder().encode('{"tasks":[]}'),
                          contentType: "application/json",
                        })
                      : Effect.fail(
                          new Execution.MationOperationError({
                            operation: "proxy",
                            cause: new Error("Mation is not connected."),
                          }),
                        ),
                  ),
                ),
            }),
            Layer.mock(Scheduler.Scheduler)({
              register: (name) =>
                Effect.sync(() => {
                  registrations.push(name);
                }),
            }),
            Layer.mock(Launch.ThreadLaunchService)({}),
            Layer.mock(Threads.ThreadManagementService)({}),
            Layer.mock(Secrets.SecretRequests)({}),
            Layer.mock(Folders.ManagedProjectFolders)({
              namedProjectsRoot: "/projects",
              isScratchProject: () => Effect.succeed(false),
            }),
            NodeCrypto.layer,
            Sqlite.layerMemory,
          ),
        ),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Scheduled.ScheduledTaskService;
          if (ownsSchedules === "1" && url === undefined) {
            const error = yield* service.list().pipe(Effect.flip);
            assert.equal(error._tag, "ScheduledTaskError");
            assert.match(error.message, /unavailable.*No local T3 schedule/);
            return;
          }
          const result = yield* service.list();
          assert.deepEqual(result.tasks, []);
        }).pipe(Effect.provide(selected)),
      );
      assert.deepEqual(
        registrations,
        ownsSchedules === "1" ? [] : ["scheduled-tasks", "webhook-coalescing"],
      );
      assert.deepEqual(calls, ownsSchedules === "1" ? ["/api/t3/tasks"] : []);
    }),
);
