export const WORKFLOW_ACTION_EVENT = "t3:ticket-workflow";
export function requestWorkflowAction(action: "ticket" | "refine") {
  window.dispatchEvent(new CustomEvent(WORKFLOW_ACTION_EVENT, { detail: action }));
}
