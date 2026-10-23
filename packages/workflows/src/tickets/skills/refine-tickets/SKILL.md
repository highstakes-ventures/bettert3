---
name: refine-tickets
description: Collaboratively turn a prepared BetterT3 Linear ticket into an approved implementation brief with architectural design, settled behavior, proof, and PR delivery requirements. Use in the ticket refinement chat; maintain the existing ticket rather than rerunning automatic preparation.
---

# Refine tickets

Work with the user in the existing chat while maintaining the actual Linear
ticket. Frontload investigation and decisions so an implementation agent can
deliver one coherent PR without another planning conversation.

Read `t3_workflow_read` and [the shared ticket brief](../prepare-tickets/references/ticket-brief.md).
Keep its preparation form current and complete its refinement extension. Do not
define another template or a competing specification in comments or local notes.
Keep the shared brief's compact, mostly ASD-STE100 writing style. Replace settled
questions with decisions instead of appending the discussion. Link detailed
investigation and test procedures; keep the agreed requirements and design in
the ticket. Keep requirements and proof in bullets or compact tables. Add design
as a responsibility map and call flow, with short notes for decisions the diagrams
cannot express. Remove repeated facts before saving instead of expanding each
section into prose.

## Resolve the design together

Investigate the relevant implementation, callers, contracts, and repository
instructions before making a technical recommendation. Carry forward decisions
already made. Ask the next consequential question rather than a fixed questionnaire.
Use concrete examples to distinguish rules, expected behavior, and unknowns.

Produce the architectural responsibility map and call flow at the scale of the
change. Identify authoritative state, important interfaces, preserved behavior,
failure handling, scope, and material tradeoffs. Prefer the closest existing
mechanism and remove unnecessary layers before proposing another abstraction.
Obtain the user's agreement on material product and architecture decisions.

Make acceptance criteria independently checkable. Establish the validation path,
prerequisites, access needs, and delivery finish condition in the brief. Do not
claim a check passed because a command or planned test is listed. Surface blocking
uncertainty before approval; leave ordinary implementation judgment to the agent.

## Maintain the ticket

Use `t3_workflow_update` with the ticket's current `expectedUpdatedAt`. Re-read on
a conflict and preserve newer edits. Keep project, supported labels and priority,
and native blocker IDs aligned with the chosen solution. Search for real issues
when a prerequisite changes; do not replace native dependencies with prose.

Resolve the delivery project before approval. The configured `intakeProjectId`
is an inbox, not a valid delivery target. If the ticket is still in intake or
has no project, propose an existing project that fits its purpose and scope.
If none fits, ask the user to choose or configure one. Keep the choice open
instead of inventing a project or treating intake as the destination.

If distinct outcomes need separate PRs, propose a split with clear boundaries
and dependencies and let the user decide. If the current toolkit cannot create
the agreed split, report that capability gap and retain it as blocking work.
Do not claim the tickets exist, silently shrink the scope, or split automatically.

The approved ticket version is the later PR auditor's contract. The delivery
agreement must include preserving that version, giving a fresh auditor the exact
PR revision and evidence, repairing findings, and publishing the audit result.
Do not assume a runtime audit gate exists merely because the ticket requests one.

The user alone approves, rejects, or delays through the refinement controls.
Approval authorizes the agreed implementation-to-PR cycle; merging and production
release retain their own authority. Do not implement repository changes, launch
implementation, or make lifecycle decisions from the refinement chat. Code owns
queue order, capacity, dependency checks, and launch admission.

## Sources

Original BetterT3 guidance informed by Matt Wynne's
[Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/) and
selected principles in Matt Pocock's [Writing Agent Briefs](https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/AGENT-BRIEF.md).
Use the ideas in original wording. Their ceremonies, labels, and separate brief
artifacts do not define this workflow.
