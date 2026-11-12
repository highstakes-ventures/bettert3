import { BETTERT3_WS_METHODS, BetterT3RpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";
import * as CloudThreadService from "../orchestration-v2/CloudThreadService.ts";
import * as CodexCloudChats from "../provider/CodexCloudChats.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as WorkflowRpc from "../workflows/WorkflowRpc.ts";

export const layer = Layer.merge(
  WorkflowRpc.layer,
  BetterT3RpcGroup.middleware(RpcInstrumentation).toLayer(
    Effect.gen(function* () {
      const cloudChats = yield* CodexCloudChats.CodexCloudChats;
      const cloudThreads = yield* CloudThreadService.CloudThreadService;
      const scheduledTasks = yield* ScheduledTasks.ScheduledTaskService;
      return {
        [BETTERT3_WS_METHODS.cloudChatsDestinations]: (input) =>
          cloudChats
            .destinations(input.instanceId)
            .pipe(Effect.map((destinations) => ({ destinations }))),
        [BETTERT3_WS_METHODS.cloudChatsList]: () => cloudChats.list(),
        [BETTERT3_WS_METHODS.cloudChatsRead]: (input) => cloudChats.read(input),
        [BETTERT3_WS_METHODS.cloudChatsOpen]: (input) => cloudThreads.open(input),
        [BETTERT3_WS_METHODS.scheduledTasksList]: () => scheduledTasks.list(),
      };
    }),
  ),
);
