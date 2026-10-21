export const WORKFLOW_ACTION_EVENT = "t3:ticket-workflow";
let pendingAction: "ticket" | "refine" | null = null;
export function requestWorkflowAction(action: "ticket" | "refine") {
  pendingAction = action;
  window.dispatchEvent(new CustomEvent(WORKFLOW_ACTION_EVENT, { detail: action }));
}

// A closed mobile sidebar mounts its controls after the action opens the sheet.
export function takeWorkflowAction() {
  const action = pendingAction;
  pendingAction = null;
  return action;
}
