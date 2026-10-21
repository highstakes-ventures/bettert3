---
name: audit-ticket-pr
description: Independently compare one exact PR revision with its preserved approved Linear implementation brief and validation evidence. Use as a fresh auditor after implementation; report compliance and gaps without changing the candidate, ticket, or approval decisions.
---

# Audit a ticket's PR

Determine whether the candidate implements the approved ticket and has the proof
needed for merge readiness. Work in fresh context. The implementation owner
supplies raw artifacts rather than a conclusion for you to endorse.

## Establish the comparison

Require the preserved approved ticket version, ticket identifier and URL, PR URL,
exact head and base revisions, candidate diff and relevant surrounding code, and
validation artifacts with their revisions. Read the repository's instructions
and acceptance requirements. Use available source-control tools to confirm the
actual candidate revision before issuing a verdict.

If the approved version is absent, the candidate cannot be identified, or decisive
evidence is inaccessible, report `blocked`. Do not reconstruct the approval from
the latest ticket or assume an implementation summary proves compliance. Note
later ticket changes separately; material scope changes need explicit approval.

## Audit the agreement

Map each acceptance criterion to implementation and appropriate evidence. Check
the intended user behavior, approved architecture and important contracts, scope
and exclusions, preserved behavior, material failure cases, native prerequisites,
and relevant migration or rollout constraints. Inspect the evidence's sensitivity
to the stated failure; passing unrelated checks proves little about a criterion.

Find missing work, unsupported validation claims, material design deviations,
and unapproved additions. Distinguish a binding decision from a suggested file
or implementation detail. Do not invent requirements, demand optional polish,
or force an architectural preference that the ticket did not approve.

Source inspection can establish structural facts. Runtime claims need suitable
runtime evidence. A listed command is not a passing result, and local proof is
not automatically production proof. Check required PR checks against the exact
head and report pending or failed requirements accurately. Report external
review or release approvals separately from technical compliance.

## Return an actionable result

Return `pass`, `changes_required`, or `blocked`, with the approved ticket revision
and exact audited PR head. Include a compact criterion-to-evidence mapping and
only concrete findings. For each finding name the violated agreement, source or
artifact location, observable consequence, and missing correction or proof.
State any material unverified requirement without claiming it passed.

The implementation owner repairs findings and publishes the audit result with
the PR and ticket link. If repairs change the candidate, verify the fixes and
affected criteria against the new head. Do not treat an earlier verdict as proof
for changed code, and do not repeat unrelated investigation without a reason.

Remain read-only. Do not edit the candidate or ticket, publish comments, approve
the ticket or PR, merge, or deploy. Audit compliance does not replace repository
protections or the user's merge and release authority. If the runtime lacks a
persisted audit gate, this report must not claim that such a gate was enforced.
