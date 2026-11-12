import { BETTERT3_WS_METHODS } from "@t3tools/contracts";

export const RPC_AGGREGATES = {
  [BETTERT3_WS_METHODS.workflowsConnection]: "workflows",
  [BETTERT3_WS_METHODS.workflowsConnect]: "workflows",
  [BETTERT3_WS_METHODS.workflowsDisconnect]: "workflows",
  [BETTERT3_WS_METHODS.workflowsSubscribe]: "workflows",
  [BETTERT3_WS_METHODS.workflowsConfigure]: "workflows",
  [BETTERT3_WS_METHODS.workflowsRead]: "workflows",
  [BETTERT3_WS_METHODS.workflowsIntake]: "workflows",
  [BETTERT3_WS_METHODS.workflowsDecide]: "workflows",
  [BETTERT3_WS_METHODS.scheduledTasksList]: "scheduledTasks",
  [BETTERT3_WS_METHODS.cloudChatsDestinations]: "provider",
  [BETTERT3_WS_METHODS.cloudChatsList]: "provider",
  [BETTERT3_WS_METHODS.cloudChatsRead]: "provider",
  [BETTERT3_WS_METHODS.cloudChatsOpen]: "provider",
} as const;
