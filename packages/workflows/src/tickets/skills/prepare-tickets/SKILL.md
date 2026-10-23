---
name: prepare-tickets
description: Normalize varied intake into a grounded BetterT3 Linear ticket with a PR-style brief, target project, metadata, duplicate handling, and native dependencies. Use during automatic preparation, before collaborative refinement. Do not split requests or approve implementation.
---

# Prepare tickets

Turn an incoming note, existing issue, or scanner finding into a useful proposal
for human refinement. Preparation improves the request without deciding missing
product requirements on the user's behalf.

## Establish the facts

Use `t3_workflow_read` for this task's current ticket, configuration, available
Linear projects, and labels. Read the original request, supplied evidence, and
relevant repository instructions. Inspect the nearest implementation and callers
before prescribing a solution. Record the inspected revision with source evidence.

Distinguish observed behavior, supported inference, and unanswered questions.
Preserve unique facts and requirements from the intake. Do not invent screenshots, timing,
user requirements, APIs, or completed validation to fill the template.

Read [the shared ticket brief](references/ticket-brief.md) and produce its
preparation form. Use mostly ASD-STE100-style English. Keep context to one or two
short sentences; write requirements, proof, and open decisions as bullets or
compact tables. Use a small flow for sequence and branches without repeating it
in prose. Before submission, remove repeated facts and check the shared brief's
output shapes. Keep detailed diagnosis in linked evidence, but retain requirements
and blockers in the ticket. A scanner's technical finding still needs a concrete
consequence and checkable outcome.

## Resolve the native ticket data

Search existing tickets with `t3_workflow_search`. Results are candidates with
bounded `descriptionExcerpt`, `descriptionTruncated`, and `hasMore`. Select plausible
IDs, then call `t3_workflow_ticket_read` for each selected issue. Compare its fresh
complete description, comments, resources, labels, and both blocker directions
before binding or excluding a duplicate. Use broader or narrower searches when
`hasMore` is true. Candidate context cannot establish complete evidence.

Compare requested outcomes,
affected behavior, and evidence before deciding that two requests are duplicates.
When the workflow supports reusing an existing issue, preserve its unique details
and use its current revision. Existing-issue binding does not itself perform a
native duplicate merge or transfer attachments. Report that distinction accurately.

Choose an existing, unfinished target Linear project by the overarching goal the
ticket advances. Prefunding and merchant payment notifications belong under
Payments; SDK guide ownership belongs under Developer experience. Route bugs
and maintenance to the goal they support. Do not propose a project for each
feature or a separate project based on the Maintenance / Improvement type.
Its native status can be Backlog. The configured `intakeProjectId` is
an inbox, never a delivery target. Use the project's native ID, not the BetterT3
workspace project's ID. If none fits, keep preparation unfinished and ask the
user to resolve the destination. Do not submit a null or intake target, invent
a project, or select an unrelated one to complete preparation.

Assign exactly one native ticket-type label from the available metadata:

- Development: Feature, Bug, or Maintenance / Improvement.
- Marketing: Content, Campaign, or Market research.

Use the label's actual ID. Preserve other useful labels. A new capability is a
Feature; broken agreed behavior is a Bug; upkeep, refactors, and performance work
are Maintenance / Improvement. Classify the requested work, not its source.
Never force a development type onto marketing. If no supported type fits, keep
preparation unfinished and ask for a suitable type instead of inventing one.
Initiatives are out of scope. Milestones are optional.

Resolve priority from available metadata. Preserve other existing properties
unless the request justifies changing them. Status and team configuration belong
to the workflow; assignee is not part of this preparation.

Relate different existing tickets using native `blockedBy` IDs. A blocker needs a
specific prerequisite that the dependent ticket cannot satisfy first. Similar
topics, an issue mention, or priority alone do not establish that relationship.
For example, second-coin support needs an FX blocker only if its intended behavior
actually requires the missing FX capability.

Use `dependencyEvidence` as supported by the toolkit. For an unmanaged code
prerequisite, supply a landed full commit SHA only after verifying it. Do not
invent a SHA or label code work external to bypass the prerequisite check.
Leave unproved prerequisites and cycles as explicit questions. Code orders the
queue; do not substitute a prose dependency list for native relations.

## Hand off to refinement

Submit `t3_workflow_result` with `type: prepared` and the supported ticket fields.
When reusing an issue, supply `existingIssueId` and its current `expectedUpdatedAt`.
If a save conflicts or partially succeeds, read the current ticket with `t3_workflow_ticket_read` and correct
the same issue using its fresh revision. Do not create a replacement by default.

Do not split one request into multiple tickets during preparation. Splitting is
a collaborative refinement decision. Do not implement code, change repository
files, approve, reject, delay, launch dependent work, or create schedules.
The existing conversation continues under `refine-tickets` when the user joins.

## Sources

Original BetterT3 guidance informed by Linear's [issue templates](https://linear.app/docs/issue-templates),
[issue properties](https://linear.app/docs/issue-property), and
[projects](https://linear.app/docs/projects). These sources describe tracker
semantics; the workflow's template and decision authority come from its user.
