import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  EnvironmentAuthorizationError,
  AuthSettingsWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import {
  ScheduledTaskListInput,
  ScheduledTaskListResult,
  ScheduledTaskError,
} from "./scheduledTask.ts";
import { RpcScopeAuthorization, WsRpcGroup } from "./rpc.ts";
import {
  WorkflowConfiguration,
  WorkflowConnectInput,
  WorkflowConnection,
  WorkflowListInput,
  WorkflowListResult,
  WorkflowReadInput,
  WorkflowDetail,
  WorkflowIntakeInput,
  WorkflowRun,
  WorkflowDecisionInput,
  WorkflowError,
} from "./workflow.ts";
import { CloudChatDestinationsResult } from "./cloudChats.ts";
import {
  CloudChatOpenInput,
  CloudChatOpenResult,
  CloudChatListInput,
  CloudChatListResult,
  CloudChatReadInput,
  CloudChatReadResult,
  CloudChatError,
} from "./cloudChats.ts";

export const BETTERT3_WS_METHODS = {
  cloudChatsDestinations: "cloudChats.destinations",
  cloudChatsList: "cloudChats.list",
  cloudChatsRead: "cloudChats.read",
  cloudChatsOpen: "cloudChats.open",
  workflowsConnection: "workflows.connection",
  workflowsConnect: "workflows.connect",
  workflowsDisconnect: "workflows.disconnect",
  workflowsSubscribe: "workflows.subscribe",
  workflowsConfigure: "workflows.configure",
  workflowsRead: "workflows.read",
  workflowsIntake: "workflows.intake",
  workflowsDecide: "workflows.decide",
  scheduledTasksList: "scheduledTasks.list",
} as const;

const WsWorkflowsConnectionRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsConnection, {
  payload: Schema.Struct({}),
  success: WorkflowConnection,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsConnectRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsConnect, {
  payload: WorkflowConnectInput,
  success: WorkflowConnection,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsDisconnectRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsDisconnect, {
  payload: Schema.Struct({}),
  success: Schema.Void,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsSubscribeRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsSubscribe, {
  payload: WorkflowListInput,
  success: WorkflowListResult,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
  stream: true,
});
const WsWorkflowsConfigureRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsConfigure, {
  payload: WorkflowConfiguration,
  success: WorkflowListResult,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsReadRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsRead, {
  payload: WorkflowReadInput,
  success: WorkflowDetail,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsIntakeRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsIntake, {
  payload: WorkflowIntakeInput,
  success: WorkflowRun,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});
const WsWorkflowsDecideRpc = Rpc.make(BETTERT3_WS_METHODS.workflowsDecide, {
  payload: WorkflowDecisionInput,
  success: WorkflowRun,
  error: Schema.Union([WorkflowError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksListRpc = Rpc.make(BETTERT3_WS_METHODS.scheduledTasksList, {
  payload: ScheduledTaskListInput,
  success: ScheduledTaskListResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

export const WorkflowRpcGroup = RpcGroup.make(
  WsWorkflowsConnectionRpc,
  WsWorkflowsConnectRpc,
  WsWorkflowsDisconnectRpc,
  WsWorkflowsSubscribeRpc,
  WsWorkflowsConfigureRpc,
  WsWorkflowsReadRpc,
  WsWorkflowsIntakeRpc,
  WsWorkflowsDecideRpc,
).middleware(RpcScopeAuthorization);

const WsCloudChatsDestinationsRpc = Rpc.make(BETTERT3_WS_METHODS.cloudChatsDestinations, {
  payload: Schema.Struct({ instanceId: ProviderInstanceId }),
  success: CloudChatDestinationsResult,
  error: Schema.Union([CloudChatError, EnvironmentAuthorizationError]),
});
const WsCloudChatsListRpc = Rpc.make(BETTERT3_WS_METHODS.cloudChatsList, {
  payload: CloudChatListInput,
  success: CloudChatListResult,
  error: Schema.Union([CloudChatError, EnvironmentAuthorizationError]),
});
const WsCloudChatsReadRpc = Rpc.make(BETTERT3_WS_METHODS.cloudChatsRead, {
  payload: CloudChatReadInput,
  success: CloudChatReadResult,
  error: Schema.Union([CloudChatError, EnvironmentAuthorizationError]),
});

const WsCloudChatsOpenRpc = Rpc.make(BETTERT3_WS_METHODS.cloudChatsOpen, {
  payload: CloudChatOpenInput,
  success: CloudChatOpenResult,
  error: Schema.Union([CloudChatError, EnvironmentAuthorizationError]),
});

export const BetterT3RpcGroup = RpcGroup.make(
  WsCloudChatsOpenRpc,
  WsCloudChatsDestinationsRpc,
  WsCloudChatsListRpc,
  WsCloudChatsReadRpc,
  WsScheduledTasksListRpc,
).middleware(RpcScopeAuthorization);

export const BetterT3WsRpcGroup = WsRpcGroup.merge(WorkflowRpcGroup, BetterT3RpcGroup);

export const BETTERT3_CLIENT_GUARDED_RPC_SCOPES = {
  [BETTERT3_WS_METHODS.cloudChatsOpen]: AuthOrchestrationOperateScope,
  [BETTERT3_WS_METHODS.workflowsConnect]: AuthSettingsWriteScope,
  [BETTERT3_WS_METHODS.workflowsDisconnect]: AuthSettingsWriteScope,
  [BETTERT3_WS_METHODS.workflowsConfigure]: AuthOrchestrationOperateScope,
  [BETTERT3_WS_METHODS.workflowsIntake]: AuthOrchestrationOperateScope,
  [BETTERT3_WS_METHODS.workflowsDecide]: AuthOrchestrationOperateScope,
} as const;

export const BETTERT3_RPC_REQUIRED_SCOPES = {
  ...BETTERT3_CLIENT_GUARDED_RPC_SCOPES,
  [BETTERT3_WS_METHODS.workflowsConnection]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.workflowsSubscribe]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.workflowsRead]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.cloudChatsDestinations]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.cloudChatsList]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.cloudChatsRead]: AuthOrchestrationReadScope,
  [BETTERT3_WS_METHODS.scheduledTasksList]: AuthOrchestrationReadScope,
} as const satisfies Readonly<
  Record<
    RpcGroup.Rpcs<typeof WorkflowRpcGroup | typeof BetterT3RpcGroup>["_tag"],
    AuthEnvironmentScope
  >
>;
